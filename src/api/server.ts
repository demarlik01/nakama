import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { AppConfig } from '../types.js';
import type { AgentRegistry } from '../core/registry.js';
import type { SessionManager } from '../core/session.js';
import type { UsageTracker } from '../core/usage.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { createAgentsRouter } from './routes/agents.js';
import { SSEManager } from './sse.js';
import { createBasicAuthMiddleware } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ApiServerDependencies {
  registry: AgentRegistry;
  sessionManager: SessionManager;
  usageTracker?: UsageTracker;
  slackConnected?: () => boolean;
  logger?: Logger;
}

export class ApiServer {
  private readonly app: Express;
  private server?: Server;
  private readonly logger: Logger;
  private readonly sseManager: SSEManager;

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
      try { statSync(path.join(d, 'index.html')); return true; } catch { return false; }
    }) ?? candidates[0]!;
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
            auth: '***REDACTED***',
          },
          workspaces: this.config.workspaces,
          api: {
            ...this.config.api,
            ...(this.config.api.auth ? { auth: { username: '***', password: '***' } } : {}),
          },
          notifications: this.config.notifications,
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

    this.app.use(
      '/api/agents',
      createAgentsRouter({
        registry: this.deps.registry,
        sessionManager: this.deps.sessionManager,
        logger: this.logger.child('agents-routes'),
      }),
    );

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
      const usage = this.deps.usageTracker.getUsage(req.params.id, period as 'day' | 'week' | 'month');

      // Include limit utilization if limits are configured
      const limits = agent.limits;
      let utilization: Record<string, unknown> | undefined;
      if (limits?.dailyTokenLimit) {
        const todayUsage = this.deps.usageTracker.getUsage(req.params.id, 'day');
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
