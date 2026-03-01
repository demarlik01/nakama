import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentDefinition } from '../types.js';

export async function buildSystemPrompt(agent: AgentDefinition): Promise<string> {
  const workspace = agent.workspacePath;

  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // TODO: Include selected docs/_shared context snippets with budget-aware truncation.
  const parts = await Promise.all([
    readFileIfExists(path.join(workspace, 'AGENTS.md')),
    readFileIfExists(path.join(workspace, 'MEMORY.md')),
    readFileIfExists(path.join(workspace, 'memory', `${today}.md`)),
    readFileIfExists(path.join(workspace, 'memory', `${yesterday}.md`)),
  ]);

  return parts.filter((part): part is string => Boolean(part)).join('\n\n---\n\n');
}

export async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

function formatDate(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
