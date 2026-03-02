import { access } from 'node:fs/promises';
import path from 'node:path';

import type { AgentDefinition } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';
import type { SessionManager } from './session.js';

const HEARTBEAT_MD = 'HEARTBEAT.md';

const DEFAULT_HEARTBEAT_PROMPT =
  'Read HEARTBEAT.md and follow it. If nothing needs attention, reply HEARTBEAT_OK.';
const FALLBACK_HEARTBEAT_PROMPT =
  'This is a heartbeat check. Review your workspace and pending tasks. If nothing needs attention, reply HEARTBEAT_OK.';
const HEARTBEAT_OK = 'HEARTBEAT_OK';

export class HeartbeatScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly postToSlack: (channelId: string, text: string, agentId: string) => Promise<void>,
    private readonly logger: Logger = createLogger('HeartbeatScheduler'),
  ) {}

  /**
   * Register an agent for heartbeat polling.
   * Clears any existing timer for this agent before setting a new one.
   */
  register(agent: AgentDefinition): void {
    this.unregister(agent.id);

    if (!agent.enabled) {
      return;
    }

    const hb = agent.heartbeat;
    if (hb === undefined || !hb.enabled) {
      return;
    }

    const intervalMs = hb.intervalMin * 60_000;

    const timer = setInterval(() => {
      void this.tick(agent).catch((err: unknown) => {
        this.logger.error('Heartbeat tick failed', {
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);

    // Don't block process exit
    timer.unref();

    this.timers.set(agent.id, timer);

    this.logger.info('Heartbeat registered', {
      agentId: agent.id,
      intervalMin: hb.intervalMin,
      quietHours: hb.quietHours,
    });
  }

  /** Unregister an agent's heartbeat timer. */
  unregister(agentId: string): void {
    const existing = this.timers.get(agentId);
    if (existing !== undefined) {
      clearInterval(existing);
      this.timers.delete(agentId);
    }
  }

  /** Stop all heartbeat timers. */
  stopAll(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.logger.info('All heartbeat timers stopped');
  }

  /** Single heartbeat tick for an agent. */
  private async tick(agent: AgentDefinition): Promise<void> {
    if (!agent.enabled) {
      return;
    }

    const hb = agent.heartbeat;
    if (hb === undefined || !hb.enabled) {
      return;
    }

    // Check quiet hours
    if (this.isQuietHour(hb.quietHours)) {
      this.logger.debug('Skipping heartbeat (quiet hours)', { agentId: agent.id });
      return;
    }

    // Build prompt
    const prompt = await this.buildPrompt(agent);

    this.logger.info('Sending heartbeat', { agentId: agent.id });

    // Determine a channel to post responses to (first configured channel)
    const channel = agent.slackChannels[0];
    if (channel === undefined) {
      this.logger.warn('No Slack channel configured for heartbeat response', {
        agentId: agent.id,
      });
      return;
    }

    // Send prompt to agent session
    const response = await this.sessionManager.handleMessage(agent.id, prompt, {
      slackChannelId: channel,
      slackUserId: 'system:heartbeat',
    });

    // If the response contains HEARTBEAT_OK, stay silent
    if (response.trim() === HEARTBEAT_OK || response.includes(HEARTBEAT_OK)) {
      this.logger.debug('Heartbeat OK (silent)', { agentId: agent.id });
      return;
    }

    // Post non-trivial response to Slack
    await this.postToSlack(channel, response, agent.id);
    this.logger.info('Heartbeat response posted', { agentId: agent.id, channel });
  }

  /** Check if the current hour falls within quiet hours [start, end). */
  private isQuietHour(quietHours: [number, number]): boolean {
    const [start, end] = quietHours;
    const hour = new Date().getHours();

    if (start <= end) {
      // e.g. [8, 17] — quiet during 8..16
      return hour >= start && hour < end;
    }
    // e.g. [23, 8] — quiet during 23..7
    return hour >= start || hour < end;
  }

  /** Build the heartbeat prompt, checking for HEARTBEAT.md existence. */
  private async buildPrompt(agent: AgentDefinition): Promise<string> {
    const heartbeatMdPath = path.join(agent.workspacePath, HEARTBEAT_MD);
    const hasHeartbeatMd = await fileExists(heartbeatMdPath);

    return hasHeartbeatMd ? DEFAULT_HEARTBEAT_PROMPT : FALLBACK_HEARTBEAT_PROMPT;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
