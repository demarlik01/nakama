import { Cron } from 'croner';

import type { AgentDefinition, CronJobConfig } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { createLogger } from '../utils/logger.js';
import type { SessionManager } from './session.js';

interface CronEntry {
  job: Cron;
  config: CronJobConfig;
  agentId: string;
}

export class CronScheduler {
  /** Map from "agentId:cronName" to CronEntry */
  private readonly jobs = new Map<string, CronEntry>();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly postToSlack: (channelId: string, text: string, agentId: string) => Promise<void>,
    private readonly logger: Logger = createLogger('CronScheduler'),
  ) {}

  /**
   * Register all cron jobs for an agent.
   * Clears any existing jobs for this agent first.
   */
  register(agent: AgentDefinition): void {
    this.unregisterAgent(agent.id);

    if (!agent.enabled) {
      return;
    }

    const cronJobs = agent.cron;
    if (cronJobs === undefined || cronJobs.length === 0) {
      return;
    }

    for (const cronConfig of cronJobs) {
      const key = `${agent.id}:${cronConfig.name}`;

      try {
        const job = new Cron(cronConfig.schedule, () => {
          void this.onTrigger(agent, cronConfig).catch((err: unknown) => {
            this.logger.error('Cron job execution failed', {
              agentId: agent.id,
              cronName: cronConfig.name,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        });

        this.jobs.set(key, { job, config: cronConfig, agentId: agent.id });

        this.logger.info('Cron job registered', {
          agentId: agent.id,
          cronName: cronConfig.name,
          schedule: cronConfig.schedule,
          channel: cronConfig.channel,
        });
      } catch (err) {
        this.logger.error('Failed to register cron job (invalid schedule?)', {
          agentId: agent.id,
          cronName: cronConfig.name,
          schedule: cronConfig.schedule,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Unregister all cron jobs for a specific agent. */
  unregisterAgent(agentId: string): void {
    for (const [key, entry] of this.jobs) {
      if (entry.agentId === agentId) {
        entry.job.stop();
        this.jobs.delete(key);
      }
    }
  }

  /** Stop all cron jobs. */
  stopAll(): void {
    for (const [, entry] of this.jobs) {
      entry.job.stop();
    }
    this.jobs.clear();
    this.logger.info('All cron jobs stopped');
  }

  /** Handle a cron trigger: send prompt to agent, post response to channel. */
  private async onTrigger(agent: AgentDefinition, cronConfig: CronJobConfig): Promise<void> {
    this.logger.info('Cron triggered', {
      agentId: agent.id,
      cronName: cronConfig.name,
    });

    const response = await this.sessionManager.handleMessage(agent.id, cronConfig.prompt, {
      slackChannelId: cronConfig.channel,
      slackUserId: 'system:cron',
    });

    await this.postToSlack(cronConfig.channel, response, agent.id);

    this.logger.info('Cron response posted', {
      agentId: agent.id,
      cronName: cronConfig.name,
      channel: cronConfig.channel,
    });
  }
}
