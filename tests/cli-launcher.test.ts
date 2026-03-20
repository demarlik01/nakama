import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('CLI launcher', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs auth status without requiring a prebuilt dist CLI', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nakama-cli-'));
    tempDirs.push(tempDir);

    const configPath = join(tempDir, 'config.yaml');
    writeFileSync(
      configPath,
      `llm:
  provider: anthropic
  defaultModel: claude-sonnet-4-20250514
  auth:
    type: api-key
    key: sk-ant-test
`,
    );

    const result = spawnSync(process.execPath, ['bin/nakama.mjs', 'auth', 'status'], {
      cwd: process.cwd(),
      env: { ...process.env, CONFIG_PATH: configPath },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Provider: anthropic');
    expect(result.stdout).toContain('Auth type: api-key');
  });
});
