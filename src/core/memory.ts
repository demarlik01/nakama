import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentDefinition } from '../types.js';

export const SYSTEM_PROMPT_TEMPLATE = `## System
You are {{agentName}}. Follow the instructions in your AGENTS.md file.

## Workspace Boundary
Your working directory is: {{workspace}}
You MUST NOT access, read, or modify any files outside this directory.
Do not access other agents workspaces or system files.
If a task requires files outside your workspace, ask the user for help.

## Response Guidelines
- Never send duplicate responses to the same message.
- Do not expose raw error messages directly to users.
- Keep responses concise and actionable.
- Follow the tone and behavior described in your AGENTS.md.

---

{{agentsMd}}

---

{{memory}}`;

export async function buildSystemPrompt(agent: AgentDefinition): Promise<string> {
  const workspace = agent.workspacePath;

  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const parts = await Promise.all([
    readFileIfExists(path.join(workspace, 'AGENTS.md')),
    readFileIfExists(path.join(workspace, 'MEMORY.md')),
    readFileIfExists(path.join(workspace, 'memory', `${today}.md`)),
    readFileIfExists(path.join(workspace, 'memory', `${yesterday}.md`)),
  ]);

  const agentsMd = normalizeSection(parts[0]);
  const memory = [parts[1], parts[2], parts[3]]
    .map((part) => normalizeSection(part))
    .filter((part) => part.length > 0)
    .join('\n\n');

  return substituteTemplate(SYSTEM_PROMPT_TEMPLATE, {
    agentName: agent.displayName,
    workspace,
    agentsMd,
    memory,
  });
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

function normalizeSection(content: string | null): string {
  return typeof content === 'string' ? content.trim() : '';
}

function substituteTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => values[key] ?? '');
}
