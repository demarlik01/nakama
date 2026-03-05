import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Cron } from 'croner';

import type {
  AgentDefinition,
  CronJob,
  CronJobConfig,
  CronSchedule,
  CronStore,
  SessionMessageContext,
} from '../types.js';
import type { Logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';
import type { AgentRegistry } from './registry.js';
import { getChannelIds } from './registry.js';
import type { SessionManager } from './session.js';
import type { HeartbeatRunner } from './heartbeat.js';

// --- Constants ---

const STUCK_RUN_MS = 2 * 3_600_000; // 2 hours
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [30_000, 60_000, 300_000];
const STORE_VERSION = 1;

// --- CronService ---

export interface CronServiceDeps {
  storePath: string;
  sessionManager: SessionManager;
  registry: AgentRegistry;
  heartbeatRunner?: HeartbeatRunner;
  postToSlack: (channelId: string, text: string, agentId: string) => Promise<void>;
  logger?: Logger;
}

/**
 * CronService — setTimeout-based cron scheduler with persistent JSON store.
 *
 * Key design:
 * - Uses croner only for computing next run times (no built-in timers)
 * - setTimeout-based timer (single timer for next due job)
 * - JSON file store for persistence and missed job recovery
 * - Two execution modes: main (inject into heartbeat) and isolated (fresh session)
 * - Error handling with retry and stuck detection
 */
export class CronService {
  private store: CronStore = { jobs: [], version: STORE_VERSION };
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly cronCache = new Map<string, Cron>();
  private readonly logger: Logger;
  private readonly storePath: string;
  private readonly sessionManager: SessionManager;
  private readonly registry: AgentRegistry;
  private readonly heartbeatRunner?: HeartbeatRunner;
  private readonly postToSlack: (channelId: string, text: string, agentId: string) => Promise<void>;

  constructor(deps: CronServiceDeps) {
    this.storePath = deps.storePath;
    this.sessionManager = deps.sessionManager;
    this.registry = deps.registry;
    this.heartbeatRunner = deps.heartbeatRunner;
    this.postToSlack = deps.postToSlack;
    this.logger = deps.logger ?? createLogger('CronService');
  }

  /** Start the cron service: load store, recover missed jobs, arm timer. */
  async start(): Promise<void> {
    await this.loadStore();
    this.clearStaleRunningMarkers();
    await this.runMissedJobs();
    this.recomputeNextRuns();
    await this.persist();
    this.armTimer();
    this.logger.info('Cron service started', { jobCount: this.store.jobs.length });
  }

  /** Stop the cron service. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.cronCache.clear();
    this.logger.info('Cron service stopped');
  }

  /**
   * Register/sync agent config cron jobs into the store.
   * Config-sourced jobs are replaced; API-sourced jobs for the agent are preserved.
   */
  async register(agent: AgentDefinition): Promise<void> {
    if (!agent.enabled) {
      await this.unregister(agent.id);
      return;
    }

    const cronConfigs = agent.cron;

    // Remove old config-sourced jobs for this agent
    this.store.jobs = this.store.jobs.filter(
      (j) => !(j.agentId === agent.id && j.source === 'config'),
    );

    if (cronConfigs !== undefined && cronConfigs.length > 0) {
      for (const config of cronConfigs) {
        const job = configToJob(agent.id, config);
        this.store.jobs.push(job);
      }
    }

    this.recomputeNextRuns();
    await this.persist();
    this.armTimer();

    this.logger.info('Cron jobs synced for agent', {
      agentId: agent.id,
      configJobs: cronConfigs?.length ?? 0,
    });
  }

  /** Remove all jobs for an agent. */
  async unregister(agentId: string): Promise<void> {
    const before = this.store.jobs.length;
    this.store.jobs = this.store.jobs.filter((j) => j.agentId !== agentId);
    if (this.store.jobs.length !== before) {
      await this.persist();
      this.armTimer();
    }
  }

  // --- CRUD API ---

  list(agentId?: string): CronJob[] {
    if (agentId !== undefined) {
      return this.store.jobs.filter((j) => j.agentId === agentId);
    }
    return [...this.store.jobs];
  }

  async add(input: {
    agentId: string;
    schedule: CronSchedule;
    sessionTarget?: 'main' | 'isolated';
    payload: { message: string; model?: string; thinking?: string };
    enabled?: boolean;
    deleteAfterRun?: boolean;
    deliverTo?: string;
  }): Promise<CronJob> {
    const job: CronJob = {
      id: randomUUID().slice(0, 8),
      agentId: input.agentId,
      schedule: input.schedule,
      sessionTarget: input.sessionTarget ?? 'main',
      payload: input.payload,
      enabled: input.enabled ?? true,
      deleteAfterRun: input.deleteAfterRun ?? false,
      source: 'api',
      deliverTo: input.deliverTo,
      state: { consecutiveErrors: 0 },
    };

    computeNextRun(job, this.getCron.bind(this));
    this.store.jobs.push(job);
    await this.persist();
    this.armTimer();

    this.logger.info('Cron job added', { jobId: job.id, agentId: job.agentId });
    return job;
  }

  async update(jobId: string, patch: Partial<Pick<CronJob, 'schedule' | 'sessionTarget' | 'payload' | 'enabled' | 'deleteAfterRun' | 'deliverTo'>>): Promise<CronJob> {
    const job = this.store.jobs.find((j) => j.id === jobId);
    if (job === undefined) {
      throw new Error(`Cron job not found: ${jobId}`);
    }

    if (patch.schedule !== undefined) job.schedule = patch.schedule;
    if (patch.sessionTarget !== undefined) job.sessionTarget = patch.sessionTarget;
    if (patch.payload !== undefined) job.payload = patch.payload;
    if (patch.enabled !== undefined) job.enabled = patch.enabled;
    if (patch.deleteAfterRun !== undefined) job.deleteAfterRun = patch.deleteAfterRun;
    if (patch.deliverTo !== undefined) job.deliverTo = patch.deliverTo;

    computeNextRun(job, this.getCron.bind(this));
    await this.persist();
    this.armTimer();

    this.logger.info('Cron job updated', { jobId });
    return job;
  }

  async remove(jobId: string): Promise<void> {
    const before = this.store.jobs.length;
    this.store.jobs = this.store.jobs.filter((j) => j.id !== jobId);
    if (this.store.jobs.length === before) {
      throw new Error(`Cron job not found: ${jobId}`);
    }
    await this.persist();
    this.armTimer();
    this.logger.info('Cron job removed', { jobId });
  }

  /** Manually trigger a job right now. */
  async runNow(jobId: string): Promise<string> {
    const job = this.store.jobs.find((j) => j.id === jobId);
    if (job === undefined) {
      throw new Error(`Cron job not found: ${jobId}`);
    }
    return this.executeJob(job);
  }

  // --- Timer ---

  private armTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const nextMs = this.getNextWakeMs();
    if (nextMs === undefined) return;

    const delay = Math.max(0, nextMs - Date.now());
    this.timer = setTimeout(() => {
      void this.onTimer();
    }, delay);
    this.timer.unref();
  }

  private async onTimer(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const now = Date.now();
      const dueJobs = this.store.jobs.filter(
        (j) => j.enabled && j.state.nextRunAtMs !== undefined && j.state.nextRunAtMs <= now,
      );

      for (const job of dueJobs) {
        try {
          await this.executeJob(job);
          job.state.lastRunStatus = 'ok';
          job.state.lastError = undefined;
          job.state.consecutiveErrors = 0;
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          job.state.lastRunStatus = 'error';
          job.state.lastError = errorMessage;
          job.state.consecutiveErrors += 1;

          this.logger.error('Cron job execution failed', {
            jobId: job.id,
            agentId: job.agentId,
            error: errorMessage,
            consecutiveErrors: job.state.consecutiveErrors,
          });

          // Retry logic for transient errors
          if (job.state.consecutiveErrors <= MAX_RETRY_ATTEMPTS) {
            const backoffIdx = Math.min(job.state.consecutiveErrors - 1, RETRY_BACKOFF_MS.length - 1);
            const backoff = RETRY_BACKOFF_MS[backoffIdx] ?? 60_000;
            job.state.nextRunAtMs = Date.now() + backoff;
            this.logger.info('Cron job scheduled for retry', {
              jobId: job.id,
              retryIn: backoff,
              attempt: job.state.consecutiveErrors,
            });
            continue; // Don't advance normal schedule
          }
        }

        job.state.lastRunAtMs = Date.now();

        // Handle one-shot jobs
        if (job.deleteAfterRun && job.schedule.kind === 'at') {
          this.store.jobs = this.store.jobs.filter((j) => j.id !== job.id);
          this.logger.info('One-shot cron job completed and removed', { jobId: job.id });
          continue;
        }

        // Advance to next run
        computeNextRun(job, this.getCron.bind(this));
      }

      await this.persist();
    } finally {
      this.running = false;
      this.armTimer();
    }
  }

  /** Execute a single cron job. Returns the agent's response. */
  private async executeJob(job: CronJob): Promise<string> {
    this.logger.info('Executing cron job', {
      jobId: job.id,
      agentId: job.agentId,
      sessionTarget: job.sessionTarget,
    });

    let response: string;

    if (job.sessionTarget === 'main') {
      // Inject into main session via heartbeat runner or direct message
      if (this.heartbeatRunner) {
        // Wake heartbeat runner to process
        this.heartbeatRunner.requestHeartbeatNow(job.agentId);
      }

      // Send message to main session
      const channel = job.deliverTo ?? this.resolveDefaultChannel(job.agentId);
      const context: SessionMessageContext = {
        slackChannelId: channel ?? 'system',
        slackUserId: `system:cron:${job.id}`,
      };

      response = await this.sessionManager.handleMessage(
        job.agentId,
        appendTimestamp(job.payload.message),
        context,
      );

      // Deliver response if it's not just an acknowledgment
      if (channel && !isNoReply(response)) {
        await this.postToSlack(channel, response, job.agentId);
      }
    } else {
      // Isolated session
      response = await this.sessionManager.runIsolatedTurn(
        job.agentId,
        appendTimestamp(job.payload.message),
        { model: job.payload.model },
      );

      // Deliver response
      const channel = job.deliverTo ?? this.resolveDefaultChannel(job.agentId);
      if (channel && !isNoReply(response)) {
        await this.postToSlack(channel, response, job.agentId);
      }
    }

    this.logger.info('Cron job executed', {
      jobId: job.id,
      responseLength: response.length,
    });

    return response;
  }

  // --- Store ---

  private async loadStore(): Promise<void> {
    try {
      const data = await readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(data) as unknown;
      if (isValidStore(parsed)) {
        this.store = parsed;
      } else {
        this.logger.warn('Invalid cron store format, starting fresh');
        this.store = { jobs: [], version: STORE_VERSION };
      }
    } catch (err: unknown) {
      if (isEnoent(err)) {
        this.store = { jobs: [], version: STORE_VERSION };
      } else {
        this.logger.error('Failed to load cron store', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.store = { jobs: [], version: STORE_VERSION };
      }
    }
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(path.dirname(this.storePath), { recursive: true });
      await writeFile(this.storePath, JSON.stringify(this.store, null, 2) + '\n', 'utf8');
    } catch (err: unknown) {
      this.logger.error('Failed to persist cron store', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Missed Jobs ---

  /** Run jobs that were missed while the service was down. */
  private async runMissedJobs(): Promise<void> {
    const now = Date.now();
    let missedCount = 0;

    for (const job of this.store.jobs) {
      if (!job.enabled) continue;
      if (job.state.nextRunAtMs === undefined) continue;
      if (job.state.nextRunAtMs > now) continue;

      // Job was due while we were down
      this.logger.info('Running missed cron job', {
        jobId: job.id,
        missedAtMs: job.state.nextRunAtMs,
      });

      try {
        await this.executeJob(job);
        job.state.lastRunAtMs = now;
        job.state.lastRunStatus = 'ok';
        job.state.consecutiveErrors = 0;
        missedCount++;

        if (job.deleteAfterRun && job.schedule.kind === 'at') {
          this.store.jobs = this.store.jobs.filter((j) => j.id !== job.id);
        }
      } catch (err: unknown) {
        job.state.lastRunStatus = 'error';
        job.state.lastError = err instanceof Error ? err.message : String(err);
        job.state.consecutiveErrors += 1;
        this.logger.error('Failed to run missed cron job', {
          jobId: job.id,
          error: job.state.lastError,
        });
      }
    }

    if (missedCount > 0) {
      this.logger.info('Missed cron jobs recovered', { count: missedCount });
    }
  }

  /** Clear stale running markers from jobs that were running when service stopped. */
  private clearStaleRunningMarkers(): void {
    const now = Date.now();
    for (const job of this.store.jobs) {
      if (
        job.state.lastRunAtMs !== undefined &&
        job.state.lastRunStatus === undefined &&
        now - job.state.lastRunAtMs > STUCK_RUN_MS
      ) {
        job.state.lastRunStatus = 'error';
        job.state.lastError = 'Stuck: exceeded 2h timeout';
        this.logger.warn('Cleared stale running marker', { jobId: job.id });
      }
    }
  }

  // --- Helpers ---

  private recomputeNextRuns(): void {
    for (const job of this.store.jobs) {
      if (!job.enabled) continue;
      computeNextRun(job, this.getCron.bind(this));
    }
  }

  private getNextWakeMs(): number | undefined {
    let earliest: number | undefined;
    for (const job of this.store.jobs) {
      if (!job.enabled) continue;
      const next = job.state.nextRunAtMs;
      if (next !== undefined && (earliest === undefined || next < earliest)) {
        earliest = next;
      }
    }
    return earliest;
  }

  private getCron(expr: string, tz?: string): Cron {
    const key = `${expr}|${tz ?? ''}`;
    let cached = this.cronCache.get(key);
    if (cached === undefined) {
      cached = new Cron(expr, { timezone: tz });
      this.cronCache.set(key, cached);
    }
    return cached;
  }

  private resolveDefaultChannel(agentId: string): string | undefined {
    const agent = this.registry.getById(agentId);
    if (agent !== undefined) {
      const channels = getChannelIds(agent);
      return channels[0];
    }
    return undefined;
  }
}

// --- Free functions ---

function configToJob(agentId: string, config: CronJobConfig): CronJob {
  const schedule = parseCronSchedule(config.schedule);
  const channel = config.channel;
  return {
    id: `cfg-${agentId}-${config.name}`,
    agentId,
    schedule,
    sessionTarget: config.sessionTarget ?? 'main',
    payload: {
      message: config.message,
      model: config.model,
      thinking: config.thinking,
    },
    enabled: true,
    deleteAfterRun: config.deleteAfterRun ?? false,
    source: 'config',
    deliverTo: channel,
    state: { consecutiveErrors: 0 },
  };
}

/**
 * Parse a schedule string into a CronSchedule.
 * Supports:
 * - Cron expression: "0 9 * * 1" or "* /5 * * * *"
 * - Duration: "30m", "1h" (becomes "every")
 * - ISO date: "2024-01-01T09:00:00Z" (becomes "at")
 */
function parseCronSchedule(schedule: string): CronSchedule {
  const trimmed = schedule.trim();

  // Check if it's an ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return { kind: 'at', at: trimmed };
  }

  // Check if it's a duration string
  if (/^\d+(?:\.\d+)?\s*(?:ms|s|m|h|d)$/i.test(trimmed)) {
    const { parseDurationMs } = await_parseDuration();
    return { kind: 'every', everyMs: parseDurationMs(trimmed) };
  }

  // Assume cron expression
  return { kind: 'cron', expr: trimmed };
}

// Sync wrapper to avoid top-level await for parseDurationMs
function await_parseDuration(): { parseDurationMs: (raw: string, defaultMs?: number) => number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DURATION_REGEX = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;
  const UNIT_MS: Record<string, number> = {
    ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000,
  };
  return {
    parseDurationMs(raw: string, defaultMs?: number): number {
      const match = raw.trim().match(DURATION_REGEX);
      if (!match) {
        if (defaultMs !== undefined) return defaultMs;
        throw new Error(`Invalid duration string: "${raw}"`);
      }
      const value = parseFloat(match[1]!);
      const unit = match[2]!.toLowerCase();
      const multiplier = UNIT_MS[unit];
      if (multiplier === undefined) throw new Error(`Unknown unit: "${unit}"`);
      return Math.round(value * multiplier);
    },
  };
}

function computeNextRun(job: CronJob, getCron: (expr: string, tz?: string) => Cron): void {
  const now = Date.now();

  switch (job.schedule.kind) {
    case 'at': {
      const atMs = new Date(job.schedule.at).getTime();
      job.state.nextRunAtMs = atMs > now ? atMs : undefined;
      break;
    }
    case 'every': {
      const lastRun = job.state.lastRunAtMs ?? now;
      job.state.nextRunAtMs = lastRun + job.schedule.everyMs;
      break;
    }
    case 'cron': {
      try {
        const cron = getCron(job.schedule.expr, job.schedule.tz);
        const next = cron.nextRun();
        job.state.nextRunAtMs = next?.getTime();
      } catch (err: unknown) {
        job.state.nextRunAtMs = undefined;
      }
      break;
    }
  }
}

function appendTimestamp(message: string): string {
  const now = new Date().toISOString();
  return `${message}\n\n[Current time: ${now}]`;
}

function isNoReply(response: string): boolean {
  const trimmed = response.trim();
  return trimmed === 'NO_REPLY' || trimmed === 'HEARTBEAT_OK' || trimmed.startsWith('HEARTBEAT_OK');
}

function isValidStore(value: unknown): value is CronStore {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.jobs) && typeof obj.version === 'number';
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'ENOENT';
}
