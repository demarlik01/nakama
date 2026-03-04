import { open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';

import type {
  AgentDefinition,
  ChannelConfig,
  CreateAgentParams,
  SessionStatus,
  UpdateAgentParams,
} from '../../types.js';
import type { AgentRegistry } from '../../core/registry.js';
import { ConflictError, NotFoundError } from '../../core/registry.js';
import type { SessionManager } from '../../core/session.js';
import { createLogger, type Logger } from '../../utils/logger.js';
import {
  listPersistedSessions,
  normalizeSessionId,
  readPersistedSession,
} from '../../core/session-files.js';
import type { UsageTracker } from '../../core/usage.js';

export interface AgentsRouterDependencies {
  registry: AgentRegistry;
  sessionManager: SessionManager;
  usageTracker?: UsageTracker;
  logger?: Logger;
}

export function createAgentsRouter(deps: AgentsRouterDependencies): Router {
  const router = Router();
  const logger = deps.logger ?? createLogger('ApiAgentsRoutes');

  router.param('id', (req, res, next, id: string) => {
    try {
      ensureSafeAgentId(id, `id (${req.method} ${req.path})`);
      next();
    } catch (error) {
      respondError(res, 400, error);
    }
  });

  router.post('/', async (req, res) => {
    try {
      const payload = asCreateAgentParams(req.body);
      const agent = await deps.registry.create(payload);
      res.status(201).json({ agent: withAgentStatus(agent, deps.sessionManager) });
    } catch (error) {
      if (error instanceof ConflictError) {
        respondError(res, 409, error);
      } else if (error instanceof RequestValidationError) {
        respondError(res, 400, error);
      } else {
        respondUnexpectedError(res, logger, error);
      }
    }
  });

  router.get('/', (_req, res) => {
    const agents = deps.registry
      .getAll()
      .map((agent) => withAgentStatus(agent, deps.sessionManager));

    res.json({ agents });
  });

  router.get('/:id', (req, res) => {
    const agent = deps.registry.getById(req.params.id);
    if (agent === undefined) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json({ agent: withAgentStatus(agent, deps.sessionManager) });
  });

  router.put('/:id', async (req, res) => {
    try {
      const payload = asUpdateAgentParams(req.body);

      // Update AGENTS.md if provided
      if (typeof req.body.agentsMd === 'string') {
        const agent = deps.registry.getById(req.params.id);
        if (agent === undefined) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }
        const agentsMdPath = path.join(agent.workspacePath, 'AGENTS.md');
        const content = req.body.agentsMd as string;
        await writeFile(agentsMdPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
      }

      const agent = await deps.registry.update(req.params.id, payload);
      res.json({ agent: withAgentStatus(agent, deps.sessionManager) });
    } catch (error) {
      if (error instanceof NotFoundError) {
        respondError(res, 404, error);
      } else if (error instanceof RequestValidationError) {
        respondError(res, 400, error);
      } else {
        respondUnexpectedError(res, logger, error);
      }
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const payload = asUpdateAgentParams(req.body);

      // Update AGENTS.md if provided
      if (typeof req.body.agentsMd === 'string') {
        const agent = deps.registry.getById(req.params.id);
        if (agent === undefined) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }
        const agentsMdPath = path.join(agent.workspacePath, 'AGENTS.md');
        const content = req.body.agentsMd as string;
        await writeFile(agentsMdPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
      }

      const agent = await deps.registry.update(req.params.id, payload);
      res.json({ agent: withAgentStatus(agent, deps.sessionManager) });
    } catch (error) {
      if (error instanceof NotFoundError) {
        respondError(res, 404, error);
      } else if (error instanceof RequestValidationError) {
        respondError(res, 400, error);
      } else {
        respondUnexpectedError(res, logger, error);
      }
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const agentId = req.params.id;

      // Dispose active session before removing
      const session = deps.sessionManager.getActiveSession(agentId);
      if (session !== undefined) {
        if (session.status === 'running' || session.queueDepth > 0) {
          res.status(409).json({
            error: 'Agent has an active running session. Wait for completion before deleting.',
          });
          return;
        }

        await deps.sessionManager.disposeSession(agentId);
        logger.info('Disposed active session before agent deletion', { agentId });
      }

      await deps.registry.remove(agentId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        respondError(res, 404, error);
      } else if (error instanceof RequestValidationError) {
        respondError(res, 400, error);
      } else {
        respondUnexpectedError(res, logger, error);
      }
    }
  });

  router.get('/:id/status', (req, res) => {
    const session = deps.sessionManager.getActiveSession(req.params.id);
    if (session === undefined) {
      const agent = deps.registry.getById(req.params.id);
      if (agent === undefined) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      res.json({ status: agent.enabled ? 'idle' : 'disabled' });
      return;
    }

    res.json({
      status: session.status,
      queueDepth: session.queueDepth,
      lastActivityAt: session.lastActivityAt,
      error: session.error,
    });
  });

  router.get('/:id/logs', async (req, res) => {
    const agent = deps.registry.getById(req.params.id);
    if (agent === undefined) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500)
      : 100;
    const level = (req.query.level as string) || undefined;

    try {
      const pm2LogPath = `${process.env.HOME}/.pm2/logs/agent-for-work-out.log`;
      const { existsSync } = await import('node:fs');

      let logs: Record<string, unknown>[] = [];
      if (existsSync(pm2LogPath)) {
        const raw = await readTailChunk(pm2LogPath, limit);
        logs = selectAgentLogEntries(raw, agent.id, limit, level);
      }

      res.json({ logs, count: logs.length });
    } catch {
      // Fallback: no logs available
      res.json({ logs: [], count: 0, note: 'No log files found. Logs are available when running under PM2.' });
    }
  });

  router.get('/:id/sessions', async (req, res) => {
    const agent = deps.registry.getById(req.params.id);
    if (agent === undefined) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    try {
      const sessions = await listPersistedSessions(agent);
      res.json({
        sessions: sessions.map((session) => ({
          sessionId: session.sessionId,
          fileName: session.fileName,
          createdAt: session.createdAt.toISOString(),
          modifiedAt: session.modifiedAt.toISOString(),
          messageCount: session.messageCount,
        })),
      });
    } catch (error) {
      respondError(res, 500, error);
    }
  });

  router.get('/:id/sessions/:sessionId', async (req, res) => {
    const agent = deps.registry.getById(req.params.id);
    if (agent === undefined) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    try {
      const session = await readPersistedSession(agent, req.params.sessionId);
      if (session === undefined) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({
        session: {
          sessionId: session.sessionId,
          fileName: session.fileName,
          createdAt: session.createdAt.toISOString(),
          modifiedAt: session.modifiedAt.toISOString(),
          messageCount: session.messageCount,
          rawJsonl: session.rawJsonl,
          messages: session.messages,
        },
      });
    } catch (error) {
      respondError(res, 500, error);
    }
  });

  router.get('/:id/sessions/:sessionId/usage', (req, res) => {
    if (!deps.usageTracker) {
      res.status(501).json({ error: 'Usage tracking not enabled' });
      return;
    }

    const agent = deps.registry.getById(req.params.id);
    if (agent === undefined) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const periodParam = req.query.period;
    const period = typeof periodParam === 'string' ? periodParam : 'day';
    if (!['day', 'week', 'month'].includes(period)) {
      res.status(400).json({ error: 'Invalid period. Use day|week|month' });
      return;
    }

    const normalizedSessionId = normalizeSessionId(req.params.sessionId);
    if (normalizedSessionId === undefined) {
      res.status(400).json({ error: 'Invalid session id' });
      return;
    }

    const usage = deps.usageTracker.getUsage(
      agent.id,
      period as 'day' | 'week' | 'month',
      normalizedSessionId,
    );
    const summary = deps.usageTracker.getSessionSummary(agent.id, normalizedSessionId);

    res.json({
      sessionId: normalizedSessionId,
      period,
      usage,
      summary,
    });
  });

  // Usage endpoint is in server.ts (backed by UsageTracker)

  router.post('/:id/message', async (req, res) => {
    try {
      const body = asObject(req.body, 'body');
      const message = asString(body.message, 'message');
      const context = asObject(body.context, 'context');

      const response = await deps.sessionManager.handleMessage(req.params.id, message, {
        slackChannelId: asString(context.slackChannelId, 'context.slackChannelId'),
        slackThreadTs: asOptionalString(context.slackThreadTs, 'context.slackThreadTs'),
        slackUserId: asString(context.slackUserId, 'context.slackUserId'),
      });

      res.json({ response });
    } catch (error) {
      respondError(res, 400, error);
    }
  });

  return router;
}

function asCreateAgentParams(value: unknown): CreateAgentParams {
  const body = asObject(value, 'body');
  const notifyChannel = asOptionalString(body.notifyChannel, 'notifyChannel');
  const legacyNotifyChannel = asOptionalString(
    body.errorNotificationChannel,
    'errorNotificationChannel',
  );
  const channels = asChannelMap(body.channels, 'channels');

  return {
    id: asString(body.id, 'id'),
    displayName: asString(body.displayName, 'displayName'),
    slackDisplayName: asOptionalString(body.slackDisplayName, 'slackDisplayName'),
    slackIcon: asOptionalString(body.slackIcon, 'slackIcon'),
    description: asOptionalString(body.description, 'description'),
    notifyChannel: notifyChannel ?? legacyNotifyChannel,
    errorNotificationChannel: legacyNotifyChannel,
    agentsMd: asOptionalString(body.agentsMd, 'agentsMd'),
    channels,
    slackUsers: asOptionalStringArray(body.slackUsers, 'slackUsers') ?? [],
    model: asString(body.model, 'model'),
  };
}

function asUpdateAgentParams(value: unknown): UpdateAgentParams {
  const body = asObject(value, 'body');

  const payload: UpdateAgentParams = {};

  if ('displayName' in body) {
    payload.displayName = asString(body.displayName, 'displayName');
  }
  if ('slackDisplayName' in body) {
    payload.slackDisplayName = asOptionalString(body.slackDisplayName, 'slackDisplayName');
  }
  if ('slackIcon' in body) {
    payload.slackIcon = asOptionalString(body.slackIcon, 'slackIcon');
  }
  if ('description' in body) {
    payload.description = asOptionalString(body.description, 'description');
  }
  if ('notifyChannel' in body || 'errorNotificationChannel' in body) {
    payload.notifyChannel = asOptionalString(
      body.notifyChannel ?? body.errorNotificationChannel,
      'notifyChannel',
    );
  }
  if ('errorNotificationChannel' in body) {
    payload.errorNotificationChannel = asOptionalString(
      body.errorNotificationChannel,
      'errorNotificationChannel',
    );
  }
  if ('channels' in body) {
    payload.channels = asChannelMap(body.channels, 'channels');
  }
  if ('slackUsers' in body) {
    payload.slackUsers = asStringArray(body.slackUsers, 'slackUsers');
  }
  if ('slackBotUserId' in body) {
    payload.slackBotUserId = asOptionalString(body.slackBotUserId, 'slackBotUserId');
  }
  if ('model' in body) {
    payload.model = asOptionalString(body.model, 'model');
  }
  if ('enabled' in body) {
    payload.enabled = asBoolean(body.enabled, 'enabled');
  }

  if ('schedules' in body) {
    payload.schedules = asAgentSchedules(body.schedules, 'schedules');
  }

  if ('limits' in body) {
    const limits = body.limits;
    if (limits !== undefined && limits !== null) {
      const l = asObject(limits, 'limits');
      payload.limits = {
        maxConcurrentSessions: asOptionalNonNegativeInteger(
          l.maxConcurrentSessions,
          'limits.maxConcurrentSessions',
        ),
        dailyTokenLimit: asOptionalNonNegativeInteger(
          l.dailyTokenLimit,
          'limits.dailyTokenLimit',
        ),
        maxMessageLength: asOptionalNonNegativeInteger(
          l.maxMessageLength,
          'limits.maxMessageLength',
        ),
        proactiveResponseMinIntervalSec: asOptionalNonNegativeInteger(
          l.proactiveResponseMinIntervalSec,
          'limits.proactiveResponseMinIntervalSec',
        ),
      };
    }
  }

  if ('reactionTriggers' in body) {
    payload.reactionTriggers = asStringArray(body.reactionTriggers, 'reactionTriggers');
  }

  return payload;
}

function asAgentSchedules(value: unknown, label: string): AgentDefinition['schedules'] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${label} must be an array`);
  }

  return value.map((schedule, index) => {
    const item = asObject(schedule, `${label}[${index}]`);

    return {
      name: asString(item.name, `${label}[${index}].name`),
      cron: asOptionalString(item.cron, `${label}[${index}].cron`),
      every: asOptionalString(item.every, `${label}[${index}].every`),
      message: asString(item.message, `${label}[${index}].message`),
      deliverTo: asString(item.deliverTo, `${label}[${index}].deliverTo`),
    };
  });
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RequestValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new RequestValidationError(`${label} must be a non-empty string when provided`);
  }

  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RequestValidationError(`${label} must be a boolean`);
  }
  return value;
}

function asOptionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RequestValidationError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${label} must be an array`);
  }

  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string') {
      throw new RequestValidationError(`${label}[${index}] must be a string`);
    }
    result.push(item);
  }

  return result;
}

function asChannelMap(value: unknown, label: string): Record<string, ChannelConfig> {
  const record = asObject(value, label);
  const channels: Record<string, ChannelConfig> = {};
  for (const [channelId, channelConfig] of Object.entries(record)) {
    if (channelConfig === undefined || channelConfig === null) {
      channels[channelId] = { mode: 'mention' };
      continue;
    }

    const configObject = asObject(channelConfig, `${label}.${channelId}`);
    channels[channelId] = {
      mode: asChannelMode(configObject.mode, `${label}.${channelId}.mode`),
    };
  }

  return channels;
}

function asChannelMode(value: unknown, label: string): ChannelConfig['mode'] {
  if (value === undefined || value === null) {
    return 'mention';
  }
  if (value !== 'mention' && value !== 'proactive') {
    throw new RequestValidationError(`${label} must be "mention" or "proactive"`);
  }
  return value;
}

function asOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return asStringArray(value, label);
}

function respondError(res: Response, statusCode: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(statusCode).json({ error: message });
}

type ApiAgentStatus = SessionStatus | 'disabled';

function withAgentStatus(
  agent: AgentDefinition,
  sessionManager: SessionManager,
): AgentDefinition & { status: ApiAgentStatus } {
  const session = sessionManager.getActiveSession(agent.id);
  return {
    ...agent,
    status: session?.status ?? (agent.enabled ? 'idle' : 'disabled'),
  };
}

function ensureSafeAgentId(id: string, label: string): void {
  if (
    id.length === 0 ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    id.includes('..')
  ) {
    throw new RequestValidationError(`${label} contains invalid path characters`);
  }
}

function selectAgentLogEntries(
  raw: string,
  agentId: string,
  limit: number,
  level?: string,
): Record<string, unknown>[] {
  const lines = raw.split('\n');
  const entries: Record<string, unknown>[] = [];

  for (let index = lines.length - 1; index >= 0 && entries.length < limit; index -= 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    const entry = parseStructuredLogLine(line);
    if (entry === undefined) {
      continue;
    }
    if (entry.agentId !== agentId) {
      continue;
    }
    if (level !== undefined && entry.level !== level) {
      continue;
    }
    entries.push(entry);
  }

  entries.reverse();
  return entries;
}

async function readTailChunk(filePath: string, lineLimit: number): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const stats = await handle.stat();
    if (stats.size <= 0) {
      return '';
    }

    const minWindowBytes = 64 * 1024;
    const maxWindowBytes = 2 * 1024 * 1024;
    const bytesPerLineBudget = 2048;
    const windowBytes = Math.max(
      minWindowBytes,
      Math.min(maxWindowBytes, lineLimit * bytesPerLineBudget),
    );

    const chunkSize = Math.min(windowBytes, stats.size);
    const startOffset = Math.max(0, stats.size - chunkSize);
    const buffer = Buffer.alloc(chunkSize);
    const { bytesRead } = await handle.read(buffer, 0, chunkSize, startOffset);

    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function parseStructuredLogLine(line: string): Record<string, unknown> | undefined {
  const jsonStart = line.indexOf('{');
  if (jsonStart < 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(line.slice(jsonStart)) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

function respondUnexpectedError(res: Response, logger: Logger, error: unknown): void {
  logger.error('Unhandled API error', {
    error: error instanceof Error ? error.message : String(error),
  });
  res.status(500).json({ error: 'Internal server error' });
}

export type AgentsRouter = ReturnType<typeof createAgentsRouter>;
