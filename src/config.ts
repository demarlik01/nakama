import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import type { AppConfig } from './types.js';

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
  const workspaces = requireObject(root.workspaces, 'workspaces');
  const api = requireObject(root.api, 'api');
  const session = requireObject(root.session, 'session');

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
      auth: requireString(llm.auth, 'llm.auth'),
    },
    workspaces: {
      root: requireString(workspaces.root, 'workspaces.root'),
      shared: requireString(workspaces.shared, 'workspaces.shared'),
    },
    api: {
      enabled: requireBoolean(api.enabled, 'api.enabled'),
      port: requireNumber(api.port, 'api.port'),
    },
    session: {
      idleTimeoutMin: requireNumber(session.idleTimeoutMin, 'session.idleTimeoutMin'),
      maxQueueSize: requireNumber(session.maxQueueSize, 'session.maxQueueSize'),
      autoSummaryOnDispose: requireBoolean(
        session.autoSummaryOnDispose,
        'session.autoSummaryOnDispose',
      ),
    },
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
