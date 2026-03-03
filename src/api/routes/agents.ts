import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';

import type {
  AgentDefinition,
  CreateAgentParams,
  SessionState,
  UpdateAgentParams,
} from '../../types.js';
import type { AgentRegistry } from '../../core/registry.js';
import { ConflictError, NotFoundError } from '../../core/registry.js';
import type { SessionManager } from '../../core/session.js';
import { createLogger, type Logger } from '../../utils/logger.js';

export interface AgentsRouterDependencies {
  registry: AgentRegistry;
  sessionManager: SessionManager;
  logger?: Logger;
}

export function createAgentsRouter(deps: AgentsRouterDependencies): Router {
  const router = Router();
  const logger = deps.logger ?? createLogger('ApiAgentsRoutes');

  router.post('/', async (req, res) => {
    try {
      const payload = asCreateAgentParams(req.body);
      const agent = await deps.registry.create(payload);
      res.status(201).json({ agent });
    } catch (error) {
      if (error instanceof ConflictError) {
        respondError(res, 409, error);
      } else {
        respondError(res, 400, error);
      }
    }
  });

  router.get('/', (_req, res) => {
    const sessions = new Map(
      deps.sessionManager
        .getAllSessions()
        .map((session) => [session.agentId, session] as const),
    );

    const agents = deps.registry.getAll().map((agent) => ({
      ...agent,
      status: sessions.get(agent.id)?.status ?? 'idle',
    }));

    res.json({ agents });
  });

  router.get('/:id', (req, res) => {
    const agent = deps.registry.getById(req.params.id);
    if (agent === undefined) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json({ agent });
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
      res.json({ agent });
    } catch (error) {
      if (error instanceof NotFoundError) {
        respondError(res, 404, error);
      } else {
        respondError(res, 400, error);
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
      res.json({ agent });
    } catch (error) {
      if (error instanceof NotFoundError) {
        respondError(res, 404, error);
      } else {
        respondError(res, 400, error);
      }
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      // Dispose active session before removing
      const session = deps.sessionManager.getActiveSession(req.params.id);
      if (session !== undefined) {
        await deps.sessionManager.disposeSession(req.params.id);
        logger.info('Disposed active session before agent deletion', { agentId: req.params.id });
      }

      await deps.registry.remove(req.params.id);
      res.status(204).send();
    } catch (error) {
      if (error instanceof NotFoundError) {
        respondError(res, 404, error);
      } else {
        respondError(res, 400, error);
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

      res.json({ status: 'idle' });
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

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const level = (req.query.level as string) || undefined;

    try {
      const { execSync } = await import('node:child_process');
      // Search structured JSON logs for this agent's entries
      // Logs are written to stdout as JSON lines; PM2 captures them in ~/.pm2/logs/
      // For dev, we grep the process stdout. This reads PM2 log files if available.
      const pm2LogPath = `${process.env.HOME}/.pm2/logs/agent-for-work-out.log`;
      const { existsSync } = await import('node:fs');

      let lines: string[] = [];

      if (existsSync(pm2LogPath)) {
        const raw = execSync(
          `grep '"agentId":"${agent.id}"' "${pm2LogPath}" | tail -n ${limit}`,
          { encoding: 'utf8', timeout: 5000 },
        ).trim();
        if (raw) lines = raw.split('\n');
      }

      // Also check recent structured logs from process stdout capture
      // Parse JSON lines and filter
      const logs = lines
        .map((line) => {
          try {
            // PM2 prepends timestamp, strip it to find JSON
            const jsonStart = line.indexOf('{');
            if (jsonStart < 0) return null;
            return JSON.parse(line.slice(jsonStart));
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => {
          if (!entry) return false;
          if (level && entry.level !== level) return false;
          return true;
        })
        .slice(-limit);

      res.json({ logs, count: logs.length });
    } catch {
      // Fallback: no logs available
      res.json({ logs: [], count: 0, note: 'No log files found. Logs are available when running under PM2.' });
    }
  });

  router.get('/:id/sessions', (req, res) => {
    const sessions = deps
      .sessionManager
      .getAllSessions()
      .filter((session) => session.agentId === req.params.id)
      .map((session) => serializeSession(session));

    res.json({ sessions });
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

function serializeSession(session: SessionState): SessionState {
  return {
    ...session,
    lastActivityAt: new Date(session.lastActivityAt),
  };
}

function asCreateAgentParams(value: unknown): CreateAgentParams {
  const body = value as Record<string, unknown>;

  return {
    id: asString(body.id, 'id'),
    displayName: asString(body.displayName, 'displayName'),
    slackDisplayName: asOptionalString(body.slackDisplayName, 'slackDisplayName'),
    slackIcon: asOptionalString(body.slackIcon, 'slackIcon'),
    description: asOptionalString(body.description, 'description'),
    agentsMd: asString(body.agentsMd, 'agentsMd'),
    slackChannels: asStringArray(body.slackChannels, 'slackChannels'),
    slackUsers: asStringArray(body.slackUsers, 'slackUsers'),
    model: asOptionalString(body.model, 'model'),
  };
}

function asUpdateAgentParams(value: unknown): UpdateAgentParams {
  const body = value as Record<string, unknown>;

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
  if ('slackChannels' in body) {
    payload.slackChannels = asStringArray(body.slackChannels, 'slackChannels');
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
        maxConcurrentSessions: l.maxConcurrentSessions !== undefined ? Number(l.maxConcurrentSessions) : undefined,
        dailyTokenLimit: l.dailyTokenLimit !== undefined ? Number(l.dailyTokenLimit) : undefined,
        maxMessageLength: l.maxMessageLength !== undefined ? Number(l.maxMessageLength) : undefined,
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
    throw new Error(`${label} must be an array`);
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
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string when provided`);
  }

  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string') {
      throw new Error(`${label}[${index}] must be a string`);
    }
    result.push(item);
  }

  return result;
}

function respondError(res: Response, statusCode: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(statusCode).json({ error: message });
}

export type AgentsRouter = ReturnType<typeof createAgentsRouter>;
