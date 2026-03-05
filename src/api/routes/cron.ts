import { Router, type Request, type Response } from 'express';

import type { CronSchedule } from '../../types.js';
import type { CronService } from '../../core/cron.js';
import { createLogger, type Logger } from '../../utils/logger.js';

export interface CronRouterDependencies {
  cronService: CronService;
  logger?: Logger;
}

export function createCronRouter(deps: CronRouterDependencies): Router {
  const router = Router();
  const logger = deps.logger ?? createLogger('CronRoutes');
  const { cronService } = deps;

  // GET /api/cron — List all cron jobs
  router.get('/', (_req: Request, res: Response) => {
    const agentId = typeof _req.query.agentId === 'string' ? _req.query.agentId : undefined;
    const jobs = cronService.list(agentId);
    res.json({ jobs });
  });

  // POST /api/cron — Add a new cron job
  router.post('/', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;

      const agentId = asRequiredString(body.agentId, 'agentId');
      const schedule = parseScheduleInput(body.schedule);
      const message = asRequiredString(
        (body.payload as Record<string, unknown> | undefined)?.message ?? body.message,
        'payload.message',
      );
      const model = asOptionalString((body.payload as Record<string, unknown> | undefined)?.model ?? body.model);
      const thinking = asOptionalString((body.payload as Record<string, unknown> | undefined)?.thinking ?? body.thinking);
      const sessionTarget = body.sessionTarget === 'isolated' ? 'isolated' as const : 'main' as const;
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
      const deleteAfterRun = typeof body.deleteAfterRun === 'boolean' ? body.deleteAfterRun : false;
      const deliverTo = asOptionalString(body.deliverTo);

      const job = await cronService.add({
        agentId,
        schedule,
        sessionTarget,
        payload: { message, model, thinking },
        enabled,
        deleteAfterRun,
        deliverTo,
      });

      res.status(201).json({ job });
    } catch (err: unknown) {
      logger.error('Failed to add cron job', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // PATCH /api/cron/:id — Update a cron job
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const jobId = req.params.id;
      if (jobId === undefined) {
        res.status(400).json({ error: 'Job ID required' });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      if (body.schedule !== undefined) patch.schedule = parseScheduleInput(body.schedule);
      if (body.sessionTarget !== undefined) patch.sessionTarget = body.sessionTarget;
      if (body.payload !== undefined) patch.payload = body.payload;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.deleteAfterRun !== undefined) patch.deleteAfterRun = body.deleteAfterRun;
      if (body.deliverTo !== undefined) patch.deliverTo = body.deliverTo;

      const job = await cronService.update(jobId, patch);
      res.json({ job });
    } catch (err: unknown) {
      const status = (err instanceof Error && err.message.includes('not found')) ? 404 : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // DELETE /api/cron/:id — Remove a cron job
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const jobId = req.params.id;
      if (jobId === undefined) {
        res.status(400).json({ error: 'Job ID required' });
        return;
      }

      await cronService.remove(jobId);
      res.json({ ok: true });
    } catch (err: unknown) {
      const status = (err instanceof Error && err.message.includes('not found')) ? 404 : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/cron/:id/run — Manually trigger a cron job
  router.post('/:id/run', async (req: Request, res: Response) => {
    try {
      const jobId = req.params.id;
      if (jobId === undefined) {
        res.status(400).json({ error: 'Job ID required' });
        return;
      }

      const response = await cronService.runNow(jobId);
      res.json({ ok: true, response: response.slice(0, 500) });
    } catch (err: unknown) {
      const status = (err instanceof Error && err.message.includes('not found')) ? 404 : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}

// --- Helpers ---

function parseScheduleInput(value: unknown): CronSchedule {
  if (typeof value === 'string') {
    // Simple string: assume cron expression
    return { kind: 'cron', expr: value };
  }

  if (typeof value !== 'object' || value === null) {
    throw new Error('schedule must be a string or object');
  }

  const obj = value as Record<string, unknown>;
  const kind = obj.kind;

  if (kind === 'at') {
    const at = asRequiredString(obj.at, 'schedule.at');
    return { kind: 'at', at };
  }

  if (kind === 'every') {
    const everyMs = typeof obj.everyMs === 'number' ? obj.everyMs : undefined;
    if (everyMs === undefined || everyMs <= 0) {
      throw new Error('schedule.everyMs must be a positive number');
    }
    return { kind: 'every', everyMs };
  }

  if (kind === 'cron') {
    const expr = asRequiredString(obj.expr, 'schedule.expr');
    const tz = asOptionalString(obj.tz);
    return { kind: 'cron', expr, tz };
  }

  throw new Error('schedule.kind must be "at", "every", or "cron"');
}

function asRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}
