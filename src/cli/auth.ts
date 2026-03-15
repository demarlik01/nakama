#!/usr/bin/env node
/**
 * nakama auth CLI — manage LLM authentication credentials.
 *
 * Usage:
 *   nakama auth login      — Anthropic OAuth browser login → config.yaml
 *   nakama auth set-key    — Set API key → config.yaml
 *   nakama auth status     — Show current auth configuration
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import YAML from 'yaml';
import { loginAnthropic } from '@mariozechner/pi-ai';

/** Resolve project root (2 levels up from dist/cli/ or src/cli/) */
function getProjectRoot(): string {
  const thisFile = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  // thisFile = <root>/dist/cli or <root>/src/cli → go up 2 levels
  return resolve(thisFile, '..', '..');
}

function getConfigPath(): string {
  if (process.env.CONFIG_PATH) {
    return resolve(process.env.CONFIG_PATH);
  }
  return resolve(getProjectRoot(), 'config.yaml');
}

function readConfigDoc(configPath: string): YAML.Document {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, 'utf8');
  return YAML.parseDocument(raw);
}

function writeConfigDoc(configPath: string, doc: YAML.Document): void {
  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, doc.toString(), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmpPath, configPath);
}

async function prompt(question: string, silent = false): Promise<string> {
  if (silent && process.stdin.isTTY) {
    // Write the prompt ourselves, then read with echo suppressed
    process.stdout.write(question);
    return new Promise((resolve) => {
      let input = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = (ch: string) => {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input.trim());
        } else if (ch === '\u007F' || ch === '\b') {
          // Backspace
          input = input.slice(0, -1);
        } else if (ch === '\u0003') {
          // Ctrl+C
          process.stdout.write('\n');
          process.exit(1);
        } else {
          input += ch;
        }
      };
      process.stdin.on('data', onData);
    });
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function handleSetKey(): Promise<void> {
  const configPath = getConfigPath();
  const key = await prompt('Enter your Anthropic API key: ', true);

  if (!key) {
    console.error('Error: API key cannot be empty.');
    process.exit(1);
  }

  const doc = readConfigDoc(configPath);
  // If auth is a scalar (old format), replace with empty map first
  const authNode = doc.getIn(['llm', 'auth']);
  if (authNode !== undefined && (typeof authNode === 'string' || typeof authNode === 'number')) {
    doc.setIn(['llm', 'auth'], {});
  }
  doc.setIn(['llm', 'auth', 'type'], 'api-key');
  doc.setIn(['llm', 'auth', 'key'], key);
  // Remove oauth fields if they exist
  doc.deleteIn(['llm', 'auth', 'accessToken']);
  doc.deleteIn(['llm', 'auth', 'refreshToken']);
  doc.deleteIn(['llm', 'auth', 'expires']);
  // Remove deprecated implementation field
  doc.deleteIn(['llm', 'implementation']);

  writeConfigDoc(configPath, doc);
  console.log('✓ API key saved to config.yaml');
}

async function handleLogin(): Promise<void> {
  const configPath = getConfigPath();

  console.log('Starting Anthropic OAuth login...\n');

  const credentials = await loginAnthropic(
    (url: string) => {
      console.log('Open this URL in your browser to authorize:\n');
      console.log(`  ${url}\n`);
    },
    async () => {
      return prompt('Enter the authorization code: ');
    },
  );

  const doc = readConfigDoc(configPath);
  // If auth is a scalar (old format), replace with empty map first
  const authNode = doc.getIn(['llm', 'auth']);
  if (authNode !== undefined && (typeof authNode === 'string' || typeof authNode === 'number')) {
    doc.setIn(['llm', 'auth'], {});
  }
  doc.setIn(['llm', 'auth', 'type'], 'oauth');
  doc.setIn(['llm', 'auth', 'accessToken'], credentials.access);
  doc.setIn(['llm', 'auth', 'refreshToken'], credentials.refresh);
  doc.setIn(['llm', 'auth', 'expires'], credentials.expires);
  // Remove api-key fields if they exist
  doc.deleteIn(['llm', 'auth', 'key']);
  // Remove deprecated implementation field
  doc.deleteIn(['llm', 'implementation']);

  writeConfigDoc(configPath, doc);

  const expiresDate = new Date(credentials.expires);
  console.log(`\n✓ OAuth tokens saved to config.yaml`);
  console.log(`  Token expires: ${expiresDate.toLocaleString()}`);
}

function handleStatus(): void {
  const configPath = getConfigPath();
  const doc = readConfigDoc(configPath);
  const parsed = doc.toJSON();

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.log('Invalid config.yaml format');
    return;
  }

  const llm = (parsed as Record<string, unknown>).llm;

  if (!llm || typeof llm !== 'object' || Array.isArray(llm)) {
    console.log('No LLM configuration found in config.yaml');
    return;
  }

  const llmConfig = llm as Record<string, unknown>;
  const auth = llmConfig.auth as Record<string, unknown> | string | undefined;
  console.log(`Provider: ${llmConfig.provider ?? '(not set)'}`);
  console.log(`Default model: ${llmConfig.defaultModel ?? '(not set)'}`);

  if (typeof auth === 'string') {
    console.log(`\n⚠ Auth is using the old string format: "${auth}"`);
    console.log('  Run "nakama auth set-key" or "nakama auth login" to migrate.');
    return;
  }

  if (!auth || typeof auth !== 'object') {
    console.log('\n⚠ No auth configuration found.');
    console.log('  Run "nakama auth set-key" or "nakama auth login" to configure.');
    return;
  }

  console.log(`\nAuth type: ${auth.type}`);

  if (auth.type === 'api-key') {
    const key = auth.key;
    if (typeof key === 'string' && key.length > 0) {
      const masked = key.slice(0, 12) + '...' + key.slice(-4);
      console.log(`API key: ${masked}`);
    }
  } else if (auth.type === 'oauth') {
    const expires = auth.expires;
    if (typeof expires === 'number') {
      const expiresDate = new Date(expires);
      const now = Date.now();
      const isExpired = now > expires;
      console.log(`Token expires: ${expiresDate.toLocaleString()}`);
      if (isExpired) {
        console.log('⚠ Token is expired. It will be auto-refreshed on next use.');
      } else {
        const remainingMs = expires - now;
        const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remainingMins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        console.log(`Remaining: ${remainingHours}h ${remainingMins}m`);
      }
    }
    const accessToken = auth.accessToken;
    if (typeof accessToken === 'string' && accessToken.length > 0) {
      const masked = accessToken.slice(0, 16) + '...' + accessToken.slice(-4);
      console.log(`Access token: ${masked}`);
    }
  }
}

export async function runAuthCli(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'login':
      await handleLogin();
      break;
    case 'set-key':
      await handleSetKey();
      break;
    case 'status':
      handleStatus();
      break;
    default:
      console.log('Usage: nakama auth <login|set-key|status>');
      console.log('');
      console.log('Commands:');
      console.log('  login    — Start Anthropic OAuth browser login');
      console.log('  set-key  — Set an API key');
      console.log('  status   — Show current auth configuration');
      process.exit(subcommand ? 1 : 0);
  }
}

// Direct execution
const isDirectRun = process.argv[1]?.endsWith('auth.js') || process.argv[1]?.endsWith('auth.ts');
if (isDirectRun) {
  runAuthCli(process.argv.slice(2)).catch((err: unknown) => {
    console.error('Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
