import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentDefinition, HeartbeatConfig } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';
import { parseDurationMs } from '../utils/duration.js';
import { getChannelIds } from './registry.js';
import type { SessionManager } from './session.js';

const HEARTBEAT_MD = 'HEARTBEAT.md';
const DEFAULT_EVERY_MS = 30 * 60_000; // 30 minutes
const HEARTBEAT_OK = 'HEARTBEAT_OK';
const HEARTBEAT_ACK_MAX_CHARS = 300;

const DEFAULT_HEARTBEAT_PROMPT =
  'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. ' +
  'Do not infer or repeat old tasks from prior chats. ' +
  'If nothing needs attention, reply HEARTBEAT_OK.';
const FALLBACK_HEARTBEAT_PROMPT =
  'This is a heartbeat check. Review your workspace and pending tasks. ' +
  'If nothing needs attention, reply HEARTBEAT_OK.';

interface AgentSchedule {
  agentId: string;
  agent: AgentDefinition;
  intervalMs: number;
  nextRunAtMs: number;
}

/**
 * HeartbeatRunner — setTimeout-based periodic heartbeat for agents.
 *
 * Key design:
 * - Uses setTimeout (not setInterval) to avoid drift
 * - Supports per-agent heartbeat config (interval, prompt, active hours)
 * - HEARTBEAT.md gate: skips if file is empty
 * - HEARTBEAT_OK detection → transcript pruning (saves tokens)
 * - requestHeartbeatNow() for external triggers (e.g. cron service)
 */
export class HeartbeatRunner {
  private readonly schedules = new Map<string, AgentSchedule>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly postToSlack: (channelId: string, text: string, agentId: string) => Promise<void>,
    private readonly logger: Logger = createLogger('HeartbeatRunner'),
  ) {}

  /**
   * Register an agent for heartbeat polling.
   * Clears any existing schedule for this agent before setting a new one.
   */
  register(agent: AgentDefinition): void {
    this.unregister(agent.id);

    if (!agent.enabled) return;

    const hb = agent.heartbeat;
    if (hb === undefined || !hb.enabled) return;

    const intervalMs = resolveIntervalMs(hb);

    const schedule: AgentSchedule = {
      agentId: agent.id,
      agent,
      intervalMs,
      nextRunAtMs: Date.now() + intervalMs,
    };

    this.schedules.set(agent.id, schedule);
    this.armTimer();

    this.logger.info('Heartbeat registered', {
      agentId: agent.id,
      intervalMs,
      activeHours: hb.activeHours,
    });
  }

  /** Unregister an agent's heartbeat schedule. */
  unregister(agentId: string): void {
    if (this.schedules.delete(agentId)) {
      this.armTimer();
    }
  }

  /** Stop all heartbeat timers. */
  stopAll(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.schedules.clear();
    this.logger.info('All heartbeat timers stopped');
  }

  /**
   * Request an immediate heartbeat for an agent.
   * Used by CronService to wake the main session.
   */
  requestHeartbeatNow(agentId: string): void {
    const schedule = this.schedules.get(agentId);
    if (schedule === undefined) {
      this.logger.warn('requestHeartbeatNow: agent not registered', { agentId });
      return;
    }

    // Set next run to now so the timer fires immediately
    schedule.nextRunAtMs = Date.now();
    this.armTimer();
  }

  /**
   * Run a single heartbeat for an agent (public for testing and cron integration).
   */
  async runOnce(agent: AgentDefinition): Promise<HeartbeatResult> {
    return this.tick(agent);
  }

  // --- Private ---

  /** Arm the timer for the next due agent. */
  private armTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.schedules.size === 0) return;

    // Find the earliest next run
    let earliest: AgentSchedule | undefined;
    for (const schedule of this.schedules.values()) {
      if (earliest === undefined || schedule.nextRunAtMs < earliest.nextRunAtMs) {
        earliest = schedule;
      }
    }

    if (earliest === undefined) return;

    const delay = Math.max(0, earliest.nextRunAtMs - Date.now());
    this.timer = setTimeout(() => {
      void this.onTimer();
    }, delay);
    this.timer.unref();
  }

  /** Timer callback — find and run all due heartbeats. */
  private async onTimer(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const now = Date.now();
      const due: AgentSchedule[] = [];

      for (const schedule of this.schedules.values()) {
        if (schedule.nextRunAtMs <= now) {
          due.push(schedule);
        }
      }

      for (const schedule of due) {
        try {
          await this.tick(schedule.agent);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.error('Heartbeat tick failed', {
            agentId: schedule.agentId,
            error: errorMsg,
          });

          // Notify the agent's first configured channel
          const errorChannel = getChannelIds(schedule.agent)[0];
          if (errorChannel) {
            const notice = `:rotating_light: *하트비트 에러*\n• *Agent:* ${schedule.agent.displayName} (\`${schedule.agentId}\`)\n• *Error:* ${errorMsg.slice(0, 200)}\n• *Time:* ${new Date().toISOString()}`;
            void this.postToSlack(errorChannel, notice, schedule.agentId).catch(() => {});
          }
        }

        // Advance schedule
        schedule.nextRunAtMs = Date.now() + schedule.intervalMs;
      }
    } finally {
      this.running = false;
      this.armTimer();
    }
  }

  /** Single heartbeat tick for an agent. */
  private async tick(agent: AgentDefinition): Promise<HeartbeatResult> {
    if (!agent.enabled) {
      return { status: 'skipped', reason: 'agent-disabled' };
    }

    const hb = agent.heartbeat;
    if (hb === undefined || !hb.enabled) {
      return { status: 'skipped', reason: 'heartbeat-disabled' };
    }

    // Check active hours
    if (!isWithinActiveHours(hb.activeHours)) {
      this.logger.debug('Skipping heartbeat (outside active hours)', { agentId: agent.id });
      return { status: 'skipped', reason: 'quiet-hours' };
    }

    // Check HEARTBEAT.md content gate
    const heartbeatContent = await readHeartbeatMd(agent.workspacePath);
    if (isEffectivelyEmpty(heartbeatContent)) {
      this.logger.debug('Skipping heartbeat (HEARTBEAT.md empty or missing)', { agentId: agent.id });
      return { status: 'skipped', reason: 'empty-heartbeat-file' };
    }

    // Build prompt
    const prompt = resolvePrompt(hb, heartbeatContent !== null);

    // Get first configured channel
    const channel = getChannelIds(agent)[0];
    if (channel === undefined) {
      this.logger.warn('No channel configured for heartbeat response', { agentId: agent.id });
      return { status: 'skipped', reason: 'no-channel' };
    }

    this.logger.info('Sending heartbeat', { agentId: agent.id });

    // Send prompt to agent's main session (regardless of sessionMode)
    const response = await this.sessionManager.handleMainSessionMessage(agent.id, prompt, {
      slackChannelId: channel,
      slackUserId: 'system:heartbeat',
    });

    // Check for HEARTBEAT_OK
    if (isHeartbeatOk(response)) {
      this.logger.debug('Heartbeat OK (silent)', { agentId: agent.id });

      // Prune the heartbeat turn from transcript to save tokens.
      // We capture message count AFTER handleMessage returns, then remove
      // only the last heartbeat turn (user prompt + assistant HEARTBEAT_OK).
      const postMessageCount = this.sessionManager.getMessageCount(agent.id);
      const pruned = this.sessionManager.pruneHeartbeatTurn(agent.id, postMessageCount);
      if (pruned > 0) {
        this.logger.debug('Pruned heartbeat transcript', {
          agentId: agent.id,
          messagesRemoved: pruned,
        });
      }

      return { status: 'ok-token', pruned };
    }

    // Post non-trivial response to channel
    await this.postToSlack(channel, response, agent.id);
    this.logger.info('Heartbeat response posted', { agentId: agent.id, channel });

    return { status: 'delivered', response };
  }
}

// --- Result type ---

export type HeartbeatResult =
  | { status: 'skipped'; reason: string }
  | { status: 'ok-token'; pruned: number }
  | { status: 'delivered'; response: string };

// --- Helper functions ---

function resolveIntervalMs(hb: HeartbeatConfig): number {
  if (hb.every !== undefined) {
    return parseDurationMs(hb.every, DEFAULT_EVERY_MS);
  }
  return DEFAULT_EVERY_MS;
}

function resolvePrompt(hb: HeartbeatConfig, hasHeartbeatMd: boolean): string {
  if (hb.prompt !== undefined) return hb.prompt;
  return hasHeartbeatMd ? DEFAULT_HEARTBEAT_PROMPT : FALLBACK_HEARTBEAT_PROMPT;
}

/**
 * Check if the response is a HEARTBEAT_OK acknowledgment.
 * Allows up to HEARTBEAT_ACK_MAX_CHARS after the token.
 */
function isHeartbeatOk(response: string): boolean {
  const trimmed = response.trim();
  if (trimmed === HEARTBEAT_OK) return true;
  if (trimmed.startsWith(HEARTBEAT_OK) && trimmed.length <= HEARTBEAT_OK.length + HEARTBEAT_ACK_MAX_CHARS) {
    return true;
  }
  return false;
}

/**
 * Check if HEARTBEAT.md content is effectively empty.
 * Returns true if null, empty, or only whitespace/comment lines.
 */
function isEffectivelyEmpty(content: string | null): boolean {
  if (content === null) return true;
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('#') && trimmed !== '---' && trimmed !== '-') {
      return false;
    }
  }
  return true;
}

/**
 * Read HEARTBEAT.md from agent workspace. Returns null if not found.
 */
async function readHeartbeatMd(workspacePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(workspacePath, HEARTBEAT_MD), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Check if the current time is within the agent's active hours.
 * If no active hours configured, always returns true.
 */
function isWithinActiveHours(activeHours?: HeartbeatConfig['activeHours']): boolean {
  if (activeHours === undefined) return true;

  const { start, end, timezone } = activeHours;
  if (start === undefined || end === undefined) return true;

  // Resolve timezone
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Get current time in the target timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour');
  const minutePart = parts.find((p) => p.type === 'minute');
  if (hourPart === undefined || minutePart === undefined) return true;

  const currentMinutes = parseInt(hourPart.value, 10) * 60 + parseInt(minutePart.value, 10);

  // Parse start/end to minutes
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes === undefined || endMinutes === undefined) return true;

  if (startMinutes <= endMinutes) {
    // Normal range: e.g. 08:00 - 23:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Overnight range: e.g. 22:00 - 06:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function parseTimeToMinutes(time: string): number | undefined {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}
