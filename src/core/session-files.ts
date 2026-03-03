import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { SessionManager as PiSessionManager } from '@mariozechner/pi-coding-agent';

import type { AgentDefinition } from '../types.js';

const JSONL_EXTENSION = '.jsonl';

type JsonRecord = Record<string, unknown>;

export interface PersistedSessionSummary {
  sessionId: string;
  fileName: string;
  filePath: string;
  createdAt: Date;
  modifiedAt: Date;
  messageCount: number;
}

export interface PersistedSessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface PersistedSessionDetail extends PersistedSessionSummary {
  messages: PersistedSessionMessage[];
}

export function getAgentSessionDir(agent: AgentDefinition): string {
  return path.join(agent.workspacePath, 'sessions');
}

export function normalizeSessionId(sessionId: string): string | undefined {
  const trimmed = sessionId.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const withoutExtension = trimmed.endsWith(JSONL_EXTENSION)
    ? trimmed.slice(0, -JSONL_EXTENSION.length)
    : trimmed;

  if (withoutExtension.length === 0) {
    return undefined;
  }

  const basename = path.basename(withoutExtension);
  if (basename !== withoutExtension) {
    return undefined;
  }

  return basename;
}

export async function listPersistedSessions(
  agent: AgentDefinition,
): Promise<PersistedSessionSummary[]> {
  const sessionDir = getAgentSessionDir(agent);
  const resolvedSessionDir = path.resolve(sessionDir);
  await mkdir(sessionDir, { recursive: true });

  const sessions = await PiSessionManager.list(agent.workspacePath, sessionDir);

  const persisted = sessions
    .map((session) => {
      const filePath = path.resolve(session.path);
      if (!isPathInsideDir(filePath, resolvedSessionDir)) {
        return undefined;
      }

      const fileName = path.basename(filePath);
      if (!fileName.endsWith(JSONL_EXTENSION)) {
        return undefined;
      }

      const sessionId = normalizeSessionId(fileName);
      if (sessionId === undefined) {
        return undefined;
      }

      return {
        sessionId,
        fileName,
        filePath,
        createdAt: session.created,
        modifiedAt: session.modified,
        messageCount: session.messageCount,
      } satisfies PersistedSessionSummary;
    })
    .filter((session): session is PersistedSessionSummary => session !== undefined);

  persisted.sort(
    (left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime(),
  );

  return persisted;
}

export async function readPersistedSession(
  agent: AgentDefinition,
  sessionId: string,
): Promise<PersistedSessionDetail | undefined> {
  const normalizedId = normalizeSessionId(sessionId);
  if (normalizedId === undefined) {
    return undefined;
  }

  const sessions = await listPersistedSessions(agent);
  const summary = sessions.find((session) => session.sessionId === normalizedId);
  if (summary === undefined) {
    return undefined;
  }

  let content: string;
  try {
    content = await readFile(summary.filePath, 'utf8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
  const lines = content.split('\n');
  const messages: PersistedSessionMessage[] = [];

  let sessionTimestamp = summary.createdAt.toISOString();

  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }

    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    if (entry.type === 'session') {
      const parsed = toIsoTimestamp(entry.timestamp);
      if (parsed !== undefined) {
        sessionTimestamp = parsed;
      }
      continue;
    }

    if (entry.type !== 'message' || !isRecord(entry.message)) {
      continue;
    }

    const role = entry.message.role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    const timestamp =
      toIsoTimestamp(entry.message.timestamp) ??
      toIsoTimestamp(entry.timestamp) ??
      sessionTimestamp;

    messages.push({
      role,
      content: extractMessageContent(entry.message.content),
      timestamp,
    });
  }

  return {
    ...summary,
    messageCount: messages.length,
    messages,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '(No text content)';
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text);
    }
  }

  return parts.length > 0 ? parts.join('') : '(No text content)';
}

function toIsoTimestamp(value: unknown): string | undefined {
  let date: Date | undefined;

  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value);
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      date = new Date(parsed);
    }
  }

  if (date === undefined || Number.isNaN(date.getTime())) {
    return undefined;
  }

  try {
    return date.toISOString();
  } catch {
    return undefined;
  }
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === expectedCode;
}

function isPathInsideDir(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, filePath);
  if (relative.length === 0) {
    return false;
  }

  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
