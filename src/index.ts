import path from 'node:path';

import { ApiServer } from './api/server.js';
import { loadConfig } from './config.js';
import { AgentRegistry } from './core/registry.js';
import { MessageRouter } from './core/router.js';
import { SessionManager } from './core/session.js';
import { SlackGateway } from './slack/app.js';
import { createLogger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  const logger = createLogger('Bootstrap');
  const configPath = process.env.CONFIG_PATH ?? 'config.yaml';

  const config = await loadConfig(configPath);
  const workspacesRoot = path.resolve(process.cwd(), config.workspaces.root);

  const registry = new AgentRegistry(workspacesRoot, logger.child('registry'));
  const sessionManager = new SessionManager(registry, config, logger.child('session'));
  const router = new MessageRouter(registry, sessionManager, logger.child('router'));
  const apiServer = new ApiServer(config, {
    registry,
    sessionManager,
    logger: logger.child('api'),
  });
  const slackGateway = new SlackGateway(config, router, sessionManager, logger.child('slack'));

  await registry.start();
  await apiServer.start();
  await slackGateway.start();

  logger.info('Agent for Work started', {
    configPath,
    apiEnabled: config.api.enabled,
    apiPort: config.api.port,
    workspacesRoot,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutdown initiated', { signal });

    await Promise.allSettled([
      slackGateway.stop(),
      apiServer.stop(),
      registry.stop(),
    ]);

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
