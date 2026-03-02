import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { AppConfig } from '../types.js';
import type { AgentRegistry } from '../core/registry.js';
import type { SessionManager } from '../core/session.js';
import type { UsageTracker } from '../core/usage.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { createAgentsRouter } from './routes/agents.js';

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

  constructor(
    private readonly config: AppConfig,
    private readonly deps: ApiServerDependencies,
  ) {
    this.logger = deps.logger ?? createLogger('ApiServer');
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

  getApp(): Express {
    return this.app;
  }

  private configureMiddleware(): void {
    this.app.disable('x-powered-by');
    this.app.use(express.json({ limit: '1mb' }));

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
    const webDir = path.resolve(__dirname, '..', 'web');
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
          api: this.config.api,
          session: this.config.session,
          slack: {
            appToken: redactSecret(this.config.slack.appToken),
            botToken: redactSecret(this.config.slack.botToken),
          },
        },
      });
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
      res.json({ usage });
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
