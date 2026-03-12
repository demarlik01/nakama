import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
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
  rawJsonl: string;
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

  // First try PiSessionManager (handles flat directory)
  const sessions = await PiSessionManager.list(agent.workspacePath, sessionDir);

  const knownPaths = new Set<string>();

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

      const sessionId =
        (typeof session.id === 'string' ? normalizeSessionId(session.id) : undefined) ??
        normalizeSessionId(fileName);
      if (sessionId === undefined) {
        return undefined;
      }

      const createdAt = toDate(session.created);
      const modifiedAt = toDate(session.modified);
      if (createdAt === undefined || modifiedAt === undefined) {
        return undefined;
      }

      knownPaths.add(filePath);

      return {
        sessionId,
        fileName,
        filePath,
        createdAt,
        modifiedAt,
        messageCount: session.messageCount,
      } satisfies PersistedSessionSummary;
    })
    .filter((session): session is PersistedSessionSummary => session !== undefined);

  // Fallback: recursively scan subdirectories for .jsonl files missed by PiSessionManager
  try {
    const extraFiles = await findJsonlFilesRecursive(resolvedSessionDir);
    for (const filePath of extraFiles) {
      if (knownPaths.has(filePath)) continue;

      const summary = await parseJsonlSessionSummary(filePath, resolvedSessionDir);
      if (summary !== undefined) {
        persisted.push(summary);
      }
    }
  } catch {
    // Ignore errors during recursive scan — flat results still available
  }

  persisted.sort(
    (left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime(),
  );

  return persisted;
}

async function findJsonlFilesRecursive(dir: string, maxDepth = 3, currentDepth = 0): Promise<string[]> {
  if (currentDepth >= maxDepth) return [];
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    // Skip symlinks to prevent traversal attacks
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findJsonlFilesRecursive(fullPath, maxDepth, currentDepth + 1));
    } else if (entry.name.endsWith(JSONL_EXTENSION)) {
      results.push(path.resolve(fullPath));
    }
  }
  return results;
}

async function parseJsonlSessionSummary(
  filePath: string,
  resolvedSessionDir: string,
): Promise<PersistedSessionSummary | undefined> {
  if (!isPathInsideDir(filePath, resolvedSessionDir)) {
    return undefined;
  }

  // Canonicalize to catch symlink escapes
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(filePath);
  } catch {
    return undefined;
  }
  if (!isPathInsideDir(canonicalPath, resolvedSessionDir)) {
    return undefined;
  }

  const fileName = path.basename(filePath);

  let content: string;
  try {
    content = await readFile(canonicalPath, 'utf8');
  } catch {
    return undefined;
  }

  const lines = content.split('\n');
  let sessionId: string | undefined;
  let createdAt: Date | undefined;
  let messageCount = 0;

  for (const line of lines) {
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;

    if (entry.type === 'session') {
      if (typeof entry.id === 'string') {
        sessionId = normalizeSessionId(entry.id);
      }
      const ts = toDate(entry.timestamp);
      if (ts !== undefined) {
        createdAt = ts;
      }
    } else if (entry.type === 'message') {
      messageCount++;
    }
  }

  if (sessionId === undefined) {
    sessionId = normalizeSessionId(fileName);
  }
  if (sessionId === undefined) {
    return undefined;
  }

  // Use file stat for dates if not found in content
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return undefined;
  }

  return {
    sessionId,
    fileName,
    filePath,
    createdAt: createdAt ?? fileStat.birthtime,
    modifiedAt: fileStat.mtime,
    messageCount,
  };
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
  const summary = sessions.find(
    (session) =>
      session.sessionId === normalizedId || normalizeSessionId(session.fileName) === normalizedId,
  );
  if (summary === undefined) {
    return undefined;
  }

  const resolvedSessionDir = path.resolve(getAgentSessionDir(agent));
  let readTargetPath = summary.filePath;
  try {
    const resolvedFilePath = await realpath(summary.filePath);
    if (!isPathInsideDir(resolvedFilePath, resolvedSessionDir)) {
      return undefined;
    }
    readTargetPath = resolvedFilePath;
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }

  let content: string;
  try {
    content = await readFile(readTargetPath, 'utf8');
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
    rawJsonl: content,
    messageCount: messages.length,
    messages,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
}

function extractMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '(No text content)';
  }

  const parts: string[] = [];
  const toolCalls: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text);
    } else if (part.type === 'toolCall' || part.type === 'tool_use') {
      const name = typeof part.name === 'string' ? part.name : typeof part.toolName === 'string' ? part.toolName : 'tool';
      toolCalls.push(name);
    }
  }

  if (parts.length > 0) {
    return parts.join('');
  }
  if (toolCalls.length > 0) {
    return `[Tool call: ${toolCalls.join(', ')}]`;
  }
  return '(No text content)';
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
