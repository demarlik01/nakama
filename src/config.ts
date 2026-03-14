import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import type { AppConfig, LlmAuth } from './types.js';

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

type UnknownRecord = Record<string, unknown>;

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export async function loadConfig(configPath = 'config.yaml'): Promise<AppConfig> {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  const rawContent = await readFile(resolvedPath, 'utf8');

  const parsed = YAML.parse(rawContent) as unknown;
  const substituted = substituteEnv(parsed);

  return validateAppConfig(substituted);
}

export function substituteEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_match, variableName: string) => {
      const envValue = process.env[variableName];
      if (envValue === undefined) {
        throw new ConfigValidationError(
          `Missing required environment variable: ${variableName}`,
        );
      }
      return envValue;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => substituteEnv(item));
  }

  if (isPlainObject(value)) {
    const out: UnknownRecord = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = substituteEnv(nested);
    }
    return out;
  }

  return value;
}

export function validateAppConfig(config: unknown): AppConfig {
  const root = requireObject(config, 'config');

  const server = requireObject(root.server, 'server');
  const slack = requireObject(root.slack, 'slack');
  const llm = requireObject(root.llm, 'llm');
  const workspaces = (typeof root.workspaces === 'object' && root.workspaces !== null ? root.workspaces : {}) as Record<string, unknown>;
  const api = requireObject(root.api, 'api');
  const apiAuth = requireOptionalApiAuth(api.auth, 'api.auth');
  const notifications =
    root.notifications === undefined
      ? undefined
      : requireObject(root.notifications, 'notifications');
  const session = requireObject(root.session, 'session');
  const configuredSessionTtlDays =
    session.sessionTTLDays ?? session.ttlDays ?? 30;
  const sessionTtlLabel = session.sessionTTLDays !== undefined
    ? 'session.sessionTTLDays'
    : 'session.ttlDays';

  const toolsConfig = root.tools !== undefined && root.tools !== null
    ? requireObject(root.tools, 'tools')
    : undefined;
  const webSearchConfig = toolsConfig?.webSearch !== undefined && toolsConfig?.webSearch !== null
    ? requireObject(toolsConfig.webSearch, 'tools.webSearch')
    : undefined;

  return {
    server: {
      port: requireNumber(server.port, 'server.port'),
    },
    slack: {
      appToken: requireString(slack.app_token, 'slack.app_token'),
      botToken: requireString(slack.bot_token, 'slack.bot_token'),
    },
    llm: {
      provider: requireString(llm.provider, 'llm.provider'),
      defaultModel: requireString(llm.defaultModel, 'llm.defaultModel'),
      auth: requireLlmAuth(llm.auth, 'llm.auth'),
    },
    workspaces: {
      root: typeof workspaces.root === 'string' ? workspaces.root : path.join(os.homedir(), '.nakama', 'workspaces'),
      shared: typeof workspaces.shared === 'string' ? workspaces.shared : path.join(os.homedir(), '.nakama', 'shared'),
    },
    api: {
      enabled: requireBoolean(api.enabled, 'api.enabled'),
      port: requireNumber(api.port, 'api.port'),
      auth: apiAuth,
    },
    notifications:
      notifications === undefined
        ? undefined
        : {
            adminSlackUser: requireOptionalString(
              notifications.adminSlackUser,
              'notifications.adminSlackUser',
            ),
            defaultChannel: requireOptionalString(
              notifications.defaultChannel,
              'notifications.defaultChannel',
            ),
          },
    session: {
      idleTimeoutMin: requireNumber(session.idleTimeoutMin, 'session.idleTimeoutMin'),
      maxQueueSize: requireNumber(session.maxQueueSize, 'session.maxQueueSize'),
      autoSummaryOnDispose: requireBoolean(
        session.autoSummaryOnDispose,
        'session.autoSummaryOnDispose',
      ),
      ttlDays: requireNonNegativeNumber(configuredSessionTtlDays, sessionTtlLabel),
    },
    tools: webSearchConfig
      ? {
          webSearch: {
            braveApiKey: requireString(webSearchConfig.braveApiKey, 'tools.webSearch.braveApiKey'),
          },
        }
      : undefined,
  };
}

function requireOptionalApiAuth(
  value: unknown,
  pathLabel: string,
): { username: string; password: string } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const auth = requireObject(value, pathLabel);
  return {
    username: requireString(auth.username, `${pathLabel}.username`),
    password: requireString(auth.password, `${pathLabel}.password`),
  };
}

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, pathLabel: string): UnknownRecord {
  if (!isPlainObject(value)) {
    throw new ConfigValidationError(`${pathLabel} must be an object`);
  }
  return value;
}

function requireString(value: unknown, pathLabel: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigValidationError(`${pathLabel} must be a non-empty string`);
  }
  return value;
}

function requireOptionalString(value: unknown, pathLabel: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireString(value, pathLabel);
}

function requireLlmAuth(value: unknown, pathLabel: string): LlmAuth {
  // Migration hint: old string format
  if (typeof value === 'string') {
    throw new ConfigValidationError(
      `${pathLabel} must be an object with { type: 'api-key', key: '...' } or { type: 'oauth', ... }. ` +
      `The old string format (e.g. "setup-token") is no longer supported. ` +
      `Run "nakama auth set-key" or "nakama auth login" to configure authentication, ` +
      `or manually update config.yaml:\n\n` +
      `  llm:\n` +
      `    auth:\n` +
      `      type: api-key\n` +
      `      key: sk-ant-...\n`,
    );
  }

  const auth = requireObject(value, pathLabel);
  const authType = requireString(auth.type, `${pathLabel}.type`);

  if (authType === 'api-key') {
    return {
      type: 'api-key',
      key: requireString(auth.key, `${pathLabel}.key`),
    };
  }

  if (authType === 'oauth') {
    return {
      type: 'oauth',
      accessToken: requireString(auth.accessToken, `${pathLabel}.accessToken`),
      refreshToken: requireString(auth.refreshToken, `${pathLabel}.refreshToken`),
      expires: requireNumber(auth.expires, `${pathLabel}.expires`),
    };
  }

  throw new ConfigValidationError(
    `${pathLabel}.type must be "api-key" or "oauth", got "${authType}"`,
  );
}

function requireNumber(value: unknown, pathLabel: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new ConfigValidationError(`${pathLabel} must be a finite number`);
}

function requireBoolean(value: unknown, pathLabel: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }

  throw new ConfigValidationError(`${pathLabel} must be a boolean`);
}

function requireNonNegativeNumber(value: unknown, pathLabel: string): number {
  const parsed = requireNumber(value, pathLabel);
  if (parsed < 0) {
    throw new ConfigValidationError(`${pathLabel} must be greater than or equal to 0`);
  }
  return parsed;
}
