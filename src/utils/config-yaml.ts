/**
 * Shared YAML config.yaml read/write helpers.
 *
 * Used by both the CLI (src/cli/auth.ts) and runtime auth storage
 * (src/core/llm/config-auth-storage.ts) to avoid duplicating
 * YAML parsing, scalar-format migration, and atomic-write logic.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import YAML from 'yaml';

/**
 * Read and parse config.yaml as a YAML Document (preserves comments/formatting).
 * Throws if the file doesn't exist.
 */
export function readConfigDoc(configPath: string): YAML.Document {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, 'utf8');
  return YAML.parseDocument(raw);
}

/**
 * Atomically write a YAML Document back to config.yaml.
 * Uses write-to-temp + rename to prevent partial writes.
 * File mode is 0o600 (owner-only) since it contains secrets.
 */
export function writeConfigDoc(configPath: string, doc: YAML.Document): void {
  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, doc.toString(), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmpPath, configPath);
}

/**
 * Ensure llm.auth is a YAML map (not a scalar like the old `auth: setup-token` format).
 * Must be called before setIn on auth sub-keys — otherwise the YAML library throws
 * when trying to set a child on a scalar node.
 */
export function ensureAuthIsMap(doc: YAML.Document): void {
  const authNode = doc.getIn(['llm', 'auth']);
  if (authNode !== undefined && authNode !== null &&
      (typeof authNode === 'string' || typeof authNode === 'number')) {
    doc.deleteIn(['llm', 'auth']);
    doc.setIn(['llm', 'auth'], doc.createNode({}));
  }
}
