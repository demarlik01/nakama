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

  const workspaceGuard = [
    '## Workspace Boundary',
    `Your working directory is: ${workspace}`,
    'You MUST NOT access, read, or modify any files outside this directory.',
    'Do not use ../ or absolute paths to escape your workspace.',
    "Do not access other agents' workspaces or system files.",
    'If a task requires files outside your workspace, ask the user for help.',
  ].join('\n');

  const relevantParts = parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  if (relevantParts.length === 0) {
    return workspaceGuard;
  }

  return workspaceGuard + '\n\n---\n\n' + relevantParts.join('\n\n---\n\n');
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
