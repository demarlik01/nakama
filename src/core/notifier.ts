import type { AppConfig } from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';

export interface ErrorNotification {
  agentId: string;
  agentName: string;
  error: string;
  timestamp: Date;
  channel?: string;
}

/**
 * Sends error notifications to an admin via Slack DM.
 * Requires `notifications.adminSlackUser` in config and a SlackGateway reference.
 */
export class Notifier {
  private readonly logger: Logger;
  private readonly adminSlackUser?: string;
  private slackPostMessage?: (channel: string, text: string) => Promise<void>;

  constructor(config: AppConfig, logger?: Logger) {
    this.logger = logger ?? createLogger('Notifier');
    const notifications = (config as any).notifications as
      | { adminSlackUser?: string }
      | undefined;
    this.adminSlackUser = notifications?.adminSlackUser;

    if (this.adminSlackUser) {
      this.logger.info('Error notifications enabled', { adminUser: this.adminSlackUser });
    }
  }

  setSlackPoster(postMessage: (channel: string, text: string) => Promise<void>): void {
    this.slackPostMessage = postMessage;
  }

  async notifyError(notification: ErrorNotification): Promise<void> {
    const channel = notification.channel ?? this.adminSlackUser;
    if (!channel || !this.slackPostMessage) {
      this.logger.debug('Error notification skipped (not configured)', {
        agentId: notification.agentId,
      });
      return;
    }

    const message = [
      ':rotating_light: *Agent Error*',
      `• *Agent:* ${notification.agentName} (\`${notification.agentId}\`)`,
      `• *Error:* ${notification.error}`,
      `• *Time:* ${notification.timestamp.toISOString()}`,
    ].join('\n');

    try {
      await this.slackPostMessage(channel, message);
      this.logger.info('Error notification sent', {
        agentId: notification.agentId,
        channel,
      });
    } catch (err) {
      this.logger.error('Failed to send error notification', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
