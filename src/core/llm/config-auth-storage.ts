/**
 * Config-backed AuthStorageBackend for Pi SDK.
 *
 * Reads credentials from nakama's config.yaml and stores them back
 * when OAuth tokens are refreshed. This replaces the default
 * ~/.pi/agent/auth.json dependency.
 *
 * Note: nakama runs as a single instance, so no file locking is needed.
 */
import { resolve } from 'node:path';

import type { AuthStorageBackend } from '@mariozechner/pi-coding-agent';
import { AuthStorage } from '@mariozechner/pi-coding-agent';
import type { LlmAuth } from '../../types.js';
import { readConfigDoc, writeConfigDoc, ensureAuthIsMap } from '../../utils/config-yaml.js';

type LockResult<T> = {
  result: T;
  next?: string;
};

/* ------------------------------------------------------------------ */
/*  Provider-aware storage JSON helpers                               */
/* ------------------------------------------------------------------ */

/**
 * Convert our LlmAuth config to the Pi SDK AuthStorageData JSON format.
 * Pi SDK expects: { "anthropic": { type: "api_key", key: "..." } }
 * or: { "anthropic": { type: "oauth", refresh: "...", access: "...", expires: ... } }
 */
function authToStorageJson(provider: string, auth: LlmAuth): string {
  if (auth.type === 'api-key') {
    return JSON.stringify({
      [provider]: { type: 'api_key', key: auth.key },
    });
  }

  return JSON.stringify({
    [provider]: {
      type: 'oauth',
      refresh: auth.refreshToken,
      access: auth.accessToken,
      expires: auth.expires,
    },
  });
}

/**
 * Parse Pi SDK storage JSON back to our config format and update config.yaml.
 * Only reads/writes the credential for the specified provider.
 * Uses atomic write (write-to-temp → rename).
 */
function updateConfigYamlAuth(configPath: string, provider: string, storageJson: string): void {
  const data = JSON.parse(storageJson) as Record<string, unknown>;

  // Only use the credential matching our provider
  const cred = data[provider] as Record<string, unknown> | undefined;
  if (!cred || typeof cred !== 'object') return;

  // Read existing config.yaml
  const fullPath = resolve(configPath);
  let doc;
  try {
    doc = readConfigDoc(fullPath);
  } catch {
    // File not found or unreadable — nothing to update
    return;
  }
  ensureAuthIsMap(doc);

  // Validate credential fields at runtime before writing
  if (cred.type === 'api_key') {
    const key = cred.key;
    if (typeof key !== 'string' || key.length === 0) {
      console.error('[ConfigAuthStorage] Invalid api_key credential: missing or empty key');
      return;
    }
    doc.setIn(['llm', 'auth', 'type'], 'api-key');
    doc.setIn(['llm', 'auth', 'key'], key);
    // Remove oauth fields if they exist
    doc.deleteIn(['llm', 'auth', 'accessToken']);
    doc.deleteIn(['llm', 'auth', 'refreshToken']);
    doc.deleteIn(['llm', 'auth', 'expires']);
  } else if (cred.type === 'oauth') {
    const access = cred.access;
    const refresh = cred.refresh;
    const expires = cred.expires;
    if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expires !== 'number') {
      console.error('[ConfigAuthStorage] Invalid oauth credential: missing or wrong-typed fields');
      return;
    }
    doc.setIn(['llm', 'auth', 'type'], 'oauth');
    doc.setIn(['llm', 'auth', 'accessToken'], access);
    doc.setIn(['llm', 'auth', 'refreshToken'], refresh);
    doc.setIn(['llm', 'auth', 'expires'], expires);
    // Remove api-key fields if they exist
    doc.deleteIn(['llm', 'auth', 'key']);
  } else {
    console.error(`[ConfigAuthStorage] Unknown credential type: ${String(cred.type)}`);
    return;
  }

  writeConfigDoc(fullPath, doc);
}

export class ConfigAuthStorageBackend implements AuthStorageBackend {
  private currentJson: string;
  /** In-process mutex to serialize concurrent async operations (e.g. token refresh). */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly provider: string,
    private readonly auth: LlmAuth,
    configPath: string,
  ) {
    // Resolve immediately so later CWD changes don't break writes
    this.resolvedConfigPath = resolve(configPath);
    this.currentJson = authToStorageJson(provider, auth);
  }

  private readonly resolvedConfigPath: string;

  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
    const { result, next } = fn(this.currentJson);

    if (next !== undefined) {
      this.currentJson = next;
      try {
        updateConfigYamlAuth(this.resolvedConfigPath, this.provider, next);
      } catch (err: unknown) {
        console.error('[ConfigAuthStorage] Failed to persist credentials to config.yaml:', err);
      }
    }

    return result;
  }

  async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
    // Serialize concurrent async calls (e.g. simultaneous token refreshes)
    const task = this.pending.then(async () => {
      const { result, next } = await fn(this.currentJson);

      if (next !== undefined) {
        this.currentJson = next;
        try {
          updateConfigYamlAuth(this.resolvedConfigPath, this.provider, next);
        } catch (err: unknown) {
          console.error('[ConfigAuthStorage] Failed to persist credentials to config.yaml:', err);
        }
      }

      return result;
    });

    this.pending = task.catch(() => {});
    return task;
  }
}

/**
 * Create an AuthStorage instance backed by config.yaml credentials.
 */
export function createConfigAuthStorage(
  provider: string,
  auth: LlmAuth,
  configPath: string,
): AuthStorage {
  const backend = new ConfigAuthStorageBackend(provider, auth, configPath);
  return AuthStorage.fromStorage(backend);
}
