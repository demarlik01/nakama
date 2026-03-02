import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { AppConfig } from '../types.js';
import type { AgentRegistry } from '../core/registry.js';
import type { SessionManager } from '../core/session.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { createAgentsRouter } from './routes/agents.js';

export interface ApiServerDependencies {
  registry: AgentRegistry;
  sessionManager: SessionManager;
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
  }
}

function redactSecret(value: string): string {
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}
