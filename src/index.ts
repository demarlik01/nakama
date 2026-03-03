import os from 'node:os';
import path from 'node:path';

import { ApiServer } from './api/server.js';
import { loadConfig } from './config.js';
import { AgentRegistry } from './core/registry.js';
import { MessageRouter } from './core/router.js';
import { SessionManager } from './core/session.js';
import { CronScheduler } from './core/cron.js';
import { HeartbeatScheduler } from './core/heartbeat.js';
import { SlackGateway } from './slack/app.js';
import { createLogger } from './utils/logger.js';
import { UsageTracker } from './core/usage.js';
import { Notifier } from './core/notifier.js';
import { createLlmProvider } from './core/llm/factory.js';

async function bootstrap(): Promise<void> {
  const logger = createLogger('Bootstrap');
  const configPath = process.env.CONFIG_PATH ?? 'config.yaml';

  const config = await loadConfig(configPath);
  const expandHome = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());
  const workspacesRoot = path.resolve(process.cwd(), expandHome(config.workspaces.root));

  const registry = new AgentRegistry(workspacesRoot, logger.child('registry'));
  const dataDir = path.resolve(workspacesRoot, '..');
  await import('fs/promises').then(fs => fs.mkdir(dataDir, { recursive: true }));
  const usageTracker = new UsageTracker(dataDir, logger.child('usage'));
  const llmProvider = createLlmProvider({
    implementation: config.llm.implementation,
    provider: config.llm.provider,
    auth: config.llm.auth,
  });
  const sessionManager = new SessionManager(
    registry,
    config,
    logger.child('session'),
    usageTracker,
    llmProvider,
  );
  const router = new MessageRouter(registry, sessionManager, logger.child('router'));
  const apiServer = new ApiServer(config, {
    usageTracker,
    registry,
    sessionManager,
    slackConnected: () => slackGateway.isConnected(),
    logger: logger.child('api'),
  });
  const slackGateway = new SlackGateway(config, router, sessionManager, logger.child('slack'));

  // Post-to-Slack helper for schedulers (uses Slack Web API directly)
  const postToSlack = async (channelId: string, text: string, agentId: string): Promise<void> => {
    const agent = registry.getById(agentId);
    await slackGateway.postMessage(channelId, text, undefined, agent);
  };

  const heartbeatScheduler = new HeartbeatScheduler(
    sessionManager,
    postToSlack,
    logger.child('heartbeat'),
  );
  const cronScheduler = new CronScheduler(
    sessionManager,
    postToSlack,
    logger.child('cron'),
  );

  // Wire SSE manager to session manager
  sessionManager.setSSEManager(apiServer.getSSEManager());

  // Wire error notifier
  const notifier = new Notifier(config, logger.child('notifier'));
  notifier.setSlackPoster((channel, text) => slackGateway.postMessage(channel, text));
  sessionManager.setNotifier(notifier);

  await registry.start();
  await sessionManager.initialize();
  await apiServer.start();
  await slackGateway.start();

  // Initialize schedulers for all existing agents
  for (const agent of registry.getAll()) {
    heartbeatScheduler.register(agent);
    cronScheduler.register(agent);
  }

  // Re-register schedulers on agent changes
  registry.on('agent:added', (agent) => {
    heartbeatScheduler.register(agent);
    cronScheduler.register(agent);
  });
  registry.on('agent:updated', (agent) => {
    heartbeatScheduler.register(agent);
    cronScheduler.register(agent);
  });
  registry.on('agent:removed', (agentId) => {
    heartbeatScheduler.unregister(agentId);
    cronScheduler.unregisterAgent(agentId);
  });

  logger.info('Agent for Work started', {
    configPath,
    apiEnabled: config.api.enabled,
    apiPort: config.api.port,
    workspacesRoot,
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('Shutdown initiated', { signal });

    // Stop accepting new requests (Slack + API)
    await Promise.allSettled([
      slackGateway.stop(),
      apiServer.stop(),
    ]).catch((err: unknown) => {
    });

    // Wait for active sessions to complete (up to 30s)
    const activeSessions = sessionManager.getAllSessions().filter(
      (s) => s.status === 'running',
    );

    if (activeSessions.length > 0) {
      logger.info('Waiting for active sessions to complete', {
        count: activeSessions.length,
      });

      const SHUTDOWN_TIMEOUT_MS = 30_000;
      const waitStart = Date.now();

      await new Promise<void>((resolve) => {
        const check = () => {
          const running = sessionManager.getAllSessions().filter(
            (s) => s.status === 'running',
          );
          if (running.length === 0 || Date.now() - waitStart > SHUTDOWN_TIMEOUT_MS) {
            if (running.length > 0) {
              logger.warn('Shutdown timeout reached, forcing disposal', {
                remaining: running.length,
              });
            }
            resolve();
            return;
          }
          setTimeout(check, 500);
        };
        check();
      });
    }

    // Dispose all remaining sessions
    const remaining = sessionManager.getAllSessions();
    for (const session of remaining) {
      await sessionManager.disposeSession(session.agentId).catch((err: unknown) => {
        logger.error('Error disposing session during shutdown', {
          agentId: session.agentId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Stop schedulers
    heartbeatScheduler.stopAll();
    cronScheduler.stopAll();
    sessionManager.stop();
    usageTracker.close();

    await Promise.allSettled([
      registry.stop(),
    ]);

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void bootstrap().catch((error: unknown) => {
  const logger = createLogger('Bootstrap');
  logger.error('Startup failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
