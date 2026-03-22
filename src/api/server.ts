import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { AppConfig } from '../types.js';
import type { AgentRegistry } from '../core/registry.js';
import type { SessionManager } from '../core/session.js';
import type { UsageTracker } from '../core/usage.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { createAgentsRouter } from './routes/agents.js';
import { createCronRouter } from './routes/cron.js';
import { listPersistedSessions } from '../core/session-files.js';
import { SSEManager } from './sse.js';
import { createBasicAuthMiddleware } from './middleware/auth.js';
import type { CronService } from '../core/cron.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ApiServerDependencies {
  registry: AgentRegistry;
  sessionManager: SessionManager;
  usageTracker?: UsageTracker;
  cronService?: CronService;
  slackConnected?: () => boolean;
  logger?: Logger;
}

export class ApiServer {
  private readonly app: Express;
  private server?: Server;
  private readonly logger: Logger;
  private readonly sseManager: SSEManager;
  private cronRouter?: ReturnType<typeof createCronRouter>;

  constructor(
    private readonly config: AppConfig,
    private readonly deps: ApiServerDependencies,
  ) {
    this.logger = deps.logger ?? createLogger('ApiServer');
    this.sseManager = new SSEManager(this.logger.child('SSE'));
    this.app = express();
    this.configureMiddleware();
    this.configureRoutes();
  }

  async start(): Promise<void> {
    if (!this.config.api.enabled) {
      this.logger.info('API server is disabled via config');
      return;
    }

    if (this.server !== undefined) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const server = this.app.listen(this.config.api.port, () => {
        this.server = server;
        this.sseManager.start();
        this.logger.info('API server listening', { port: this.config.api.port });
        resolve();
      });

      server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (this.server === undefined) {
      return;
    }

    // Close SSE connections first so HTTP server can shut down
    this.sseManager.stop();

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error?: Error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = undefined;
    this.logger.info('API server stopped');
  }

  getSSEManager(): SSEManager {
    return this.sseManager;
  }

  setCronService(cronService: CronService): void {
    this.deps.cronService = cronService;
  }

  getApp(): Express {
    return this.app;
  }

  private configureMiddleware(): void {
    this.app.disable('x-powered-by');
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(createBasicAuthMiddleware(this.config));

    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      this.logger.info('API request', {
        method: req.method,
        path: req.path,
      });
      next();
    });
  }

  private configureRoutes(): void {
    // --- Static file serving for Web UI ---
    // In dev (tsx): __dirname = src/api, in prod: dist/api
    const candidates = [
      path.resolve(__dirname, '..', 'web'),
      path.resolve(__dirname, '..', '..', 'dist', 'web'),
    ];
    const webDir = candidates.find(d => {
      return existsSync(path.join(d, 'index.html'))
    }) ?? candidates[0] ?? path.resolve(__dirname, '..', 'web');
    this.app.use(express.static(webDir));

    this.app.get('/api/health', (_req, res) => {
      res.json({
        status: 'ok',
        slackConnected: this.deps.slackConnected?.() ?? false,
        agentCount: this.deps.registry.getAll().length,
        uptimeSec: Math.floor(process.uptime()),
      });
    });

    this.app.get('/api/config', (_req, res) => {
      res.json({
        config: {
          server: this.config.server,
          llm: {
            provider: this.config.llm.provider,
            defaultModel: this.config.llm.defaultModel,
            auth: { type: this.config.llm.auth.type, '***': 'REDACTED' },
          },
          workspaces: this.config.workspaces,
          api: {
            ...this.config.api,
            ...(this.config.api.auth ? { auth: { username: '***', password: '***' } } : {}),
          },
          session: this.config.session,
          slack: {
            appToken: redactSecret(this.config.slack.appToken),
            botToken: redactSecret(this.config.slack.botToken),
          },
        },
      });
    });

    // --- SSE endpoint ---
    this.app.get('/api/events', (req, res) => {
      this.sseManager.handleConnection(req, res);
    });

    // --- Sessions endpoint ---
    this.app.get('/api/sessions', (_req, res) => {
      const sessions = this.deps.sessionManager.getAllSessions();
      res.json(sessions);
    });

    // --- All sessions (persisted + active) endpoint ---
    this.app.get('/api/sessions/all', async (req, res) => {
      try {
        const agentFilter = typeof req.query.agent === 'string' ? req.query.agent : undefined;
        const agents = this.deps.registry.getAll();
        const filteredAgents = agentFilter
          ? agents.filter((a) => a.id === agentFilter)
          : agents;

        interface SessionListItem {
          sessionId: string;
          agentId: string;
          status: 'active' | 'archived';
          messageCount: number;
          createdAt: string;
          lastActivityAt: string;
        }

        const activeSessions = this.deps.sessionManager.getAllSessions();
        const activeSessionIds = new Set(
          activeSessions
            .filter((s) => s.sessionId !== undefined)
            .map((s) => s.sessionId as string),
        );

        const results: SessionListItem[] = [];

        // Add active sessions
        for (const session of activeSessions) {
          if (agentFilter && session.agentId !== agentFilter) continue;
          results.push({
            sessionId: session.sessionId ?? session.sessionKey,
            agentId: session.agentId,
            status: 'active',
            messageCount: 0, // Active sessions don't track message count in SessionState
            createdAt: session.lastActivityAt instanceof Date
              ? session.lastActivityAt.toISOString()
              : String(session.lastActivityAt),
            lastActivityAt: session.lastActivityAt instanceof Date
              ? session.lastActivityAt.toISOString()
              : String(session.lastActivityAt),
          });
        }

        // Add persisted sessions from each agent
        const persistedPromises = filteredAgents.map(async (agent) => {
          try {
            const persisted = await listPersistedSessions(agent);
            for (const session of persisted) {
              // If this persisted session is also active, update the active entry's messageCount
              if (activeSessionIds.has(session.sessionId)) {
                const activeEntry = results.find(
                  (r) => r.sessionId === session.sessionId && r.status === 'active',
                );
                if (activeEntry) {
                  activeEntry.messageCount = session.messageCount;
                  activeEntry.createdAt = session.createdAt.toISOString();
                }
                continue;
              }
              results.push({
                sessionId: session.sessionId,
                agentId: agent.id,
                status: 'archived',
                messageCount: session.messageCount,
                createdAt: session.createdAt.toISOString(),
                lastActivityAt: session.modifiedAt.toISOString(),
              });
            }
          } catch {
            // Skip agents whose session directory is inaccessible
          }
        });

        await Promise.all(persistedPromises);

        // Sort: active first, then by lastActivityAt descending
        results.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
        });

        res.json(results);
      } catch (error) {
        this.logger.error('Failed to list all sessions', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: 'Failed to list sessions' });
      }
    });

    this.app.use(
      '/api/agents',
      createAgentsRouter({
        registry: this.deps.registry,
        sessionManager: this.deps.sessionManager,
        usageTracker: this.deps.usageTracker,
        logger: this.logger.child('agents-routes'),
      }),
    );

    // --- Cron endpoints (lazy: cronService may be set after construction) ---
    this.app.use('/api/cron', (req, res, next) => {
      if (!this.deps.cronService) {
        res.status(503).json({ error: 'Cron service not initialized' });
        return;
      }
      if (!this.cronRouter) {
        this.cronRouter = createCronRouter({
          cronService: this.deps.cronService,
          logger: this.logger.child('cron-routes'),
        });
      }
      this.cronRouter(req, res, next);
    });

    // --- AGENTS.md read endpoint ---
    this.app.get('/api/agents/:id/agents-md', async (req, res) => {
      const agent = this.deps.registry.getById(req.params.id);
      if (agent === undefined) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      try {
        const content = await readFile(path.join(agent.workspacePath, 'AGENTS.md'), 'utf8');
        res.json({ content });
      } catch {
        res.json({ content: '' });
      }
    });

    // --- Usage endpoints ---
    this.app.get('/api/agents/:id/usage', (req, res) => {
      if (!this.deps.usageTracker) {
        res.status(501).json({ error: 'Usage tracking not enabled' });
        return;
      }
      const agent = this.deps.registry.getById(req.params.id);
      if (agent === undefined) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      const period = (req.query.period as string) || 'day';
      if (!['day', 'week', 'month'].includes(period)) {
        res.status(400).json({ error: 'Invalid period. Use day|week|month' });
        return;
      }
      const usage = period === 'day'
        ? this.deps.usageTracker.getDailyUsage(req.params.id)
        : period === 'week'
          ? this.deps.usageTracker.getWeeklyUsage(req.params.id)
          : this.deps.usageTracker.getUsage(req.params.id, 'month');

      // Include limit utilization if limits are configured
      const limits = agent.limits;
      let utilization: Record<string, unknown> | undefined;
      if (limits?.dailyTokenLimit) {
        const todayUsage = this.deps.usageTracker.getDailyUsage(req.params.id);
        const today = todayUsage[todayUsage.length - 1];
        const todayTokens = today ? today.totalTokens : 0;
        utilization = {
          dailyTokens: todayTokens,
          dailyTokenLimit: limits.dailyTokenLimit,
          dailyUtilizationPct: Math.round((todayTokens / limits.dailyTokenLimit) * 100),
        };
      }

      res.json({ usage, limits, utilization });
    });

    this.app.get('/api/usage/summary', (_req, res) => {
      if (!this.deps.usageTracker) {
        res.status(501).json({ error: 'Usage tracking not enabled' });
        return;
      }
      const summary = this.deps.usageTracker.getSummary();
      res.json({ summary });
    });

    // --- SPA fallback: serve index.html for non-API routes ---
    this.app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }
}

function redactSecret(value: string): string {
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}
