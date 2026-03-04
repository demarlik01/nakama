import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import type { AgentDefinition } from '../src/types.js';
import { buildSystemPrompt } from '../src/core/memory.js';

describe('buildSystemPrompt', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'memory-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('includes MEMORY.md, today, and yesterday files when present', async () => {
    mkdirSync(join(tempDir, 'memory'), { recursive: true });
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agent');
    writeFileSync(join(tempDir, 'MEMORY.md'), 'Durable memory');
    writeFileSync(join(tempDir, 'memory', `${formatDate(new Date())}.md`), 'Today memory');
    writeFileSync(
      join(tempDir, 'memory', `${formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000))}.md`),
      'Yesterday memory',
    );

    const prompt = await buildSystemPrompt(buildAgent(tempDir));
    expect(prompt).toContain('## System');
    expect(prompt).toContain('You are Agent. Follow the instructions in your AGENTS.md file.');
    expect(prompt).toContain(`Your working directory is: ${tempDir}`);
    expect(prompt).toContain('## Response Guidelines');
    expect(prompt).toContain('# Agent');
    expect(prompt).toContain('Durable memory');
    expect(prompt).toContain('Today memory');
    expect(prompt).toContain('Yesterday memory');
  });

  it('omits empty memory files from prompt context', async () => {
    mkdirSync(join(tempDir, 'memory'), { recursive: true });
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agent');
    writeFileSync(join(tempDir, 'MEMORY.md'), '   \n');
    writeFileSync(join(tempDir, 'memory', `${formatDate(new Date())}.md`), '');
    writeFileSync(
      join(tempDir, 'memory', `${formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000))}.md`),
      'Yesterday memory',
    );

    const prompt = await buildSystemPrompt(buildAgent(tempDir));
    expect(prompt).toContain('Yesterday memory');
    expect(prompt).not.toContain('Durable memory');
    expect(prompt).not.toContain('\n\n   \n\n');
  });

  it('renders required static response guideline rules', async () => {
    const prompt = await buildSystemPrompt(buildAgent(tempDir));

    expect(prompt).toContain('- Never send duplicate responses to the same message.');
    expect(prompt).toContain('- Do not expose raw error messages directly to users.');
    expect(prompt).toContain('- Keep responses concise and actionable.');
    expect(prompt).toContain('- Follow the tone and behavior described in your AGENTS.md.');
    expect(prompt).toContain('Do not use ../ or absolute paths to escape your workspace.');
  });
});

function buildAgent(workspacePath: string): AgentDefinition {
  return {
    id: 'agent',
    displayName: 'Agent',
    workspacePath,
    slackChannels: [],
    slackUsers: [],
    enabled: true,
  };
}

function formatDate(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
