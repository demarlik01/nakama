import { App } from '@slack/bolt';

import type { AppConfig, SlackMessageEvent } from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { MessageRouter } from '../core/router.js';
import type { SessionManager } from '../core/session.js';

interface SayPayload {
  text: string;
  thread_ts?: string;
}

type SayLike = (message: string | SayPayload) => Promise<unknown>;

export class SlackGateway {
  private app?: App;

  constructor(
    private readonly config: AppConfig,
    private readonly router: MessageRouter,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger = createLogger('SlackGateway'),
  ) {}

  async start(): Promise<void> {
    if (this.app !== undefined) {
      return;
    }

    this.app = new App({
      token: this.config.slack.botToken,
      appToken: this.config.slack.appToken,
      socketMode: true,
    });

    this.registerEventHandlers(this.app);
    await this.app.start();

    this.logger.info('Slack gateway started');
  }

  async stop(): Promise<void> {
    if (this.app === undefined) {
      return;
    }

    await this.app.stop();
    this.app = undefined;

    this.logger.info('Slack gateway stopped');
  }

  private registerEventHandlers(app: App): void {
    app.event('app_mention', async ({ event, say }) => {
      await this.handleSlackEvent(event as unknown as Record<string, unknown>, say as SayLike, 'app_mention');
    });

    app.event('message', async ({ event, say }) => {
      const genericEvent = event as unknown as Record<string, unknown>;
      if (typeof genericEvent.subtype === 'string') {
        return;
      }

      await this.handleSlackEvent(genericEvent, say as SayLike, 'message');
    });
  }

  private async handleSlackEvent(
    rawEvent: Record<string, unknown>,
    say: SayLike,
    type: string,
  ): Promise<void> {
    const normalized = normalizeEvent(rawEvent, type);
    const route = this.router.route(normalized);

    if (route === null) {
      this.logger.debug('No route found for Slack event', {
        type,
        channel: normalized.channel,
        user: normalized.user,
      });
      return;
    }

    const incomingThreadTs = normalized.threadTs ?? normalized.thread_ts;
    const threadTs = incomingThreadTs ?? inferThreadTs(rawEvent);

    const response = await this.sessionManager.handleMessage(
      route.agent.id,
      normalized.text ?? '',
      {
        slackChannelId: normalized.channel ?? '',
        slackThreadTs: threadTs,
        slackUserId: normalized.user ?? 'unknown',
      },
    );

    await this.replyToSlack(say, response, threadTs);
  }

  private async replyToSlack(say: SayLike, text: string, threadTs?: string): Promise<void> {
    const chunks = splitMessage(text, SLACK_MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      if (threadTs !== undefined) {
        await say({ text: chunk, thread_ts: threadTs });
      } else {
        await say(chunk);
      }
    }
  }
}

const SLACK_MAX_MESSAGE_LENGTH = 4000;

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline boundary
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex <= 0 || splitIndex < maxLength * 0.5) {
      // Fall back to splitting at a space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex <= 0) {
      // Hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

function normalizeEvent(raw: Record<string, unknown>, type: string): SlackMessageEvent {
  const text = asOptionalString(raw.text);
  const user = asOptionalString(raw.user);
  const channel = asOptionalString(raw.channel);
  const threadTs = asOptionalString(raw.thread_ts);
  const channelType = asOptionalString(raw.channel_type);

  return {
    type,
    text,
    user,
    channel,
    channel_type: channelType,
    channelType,
    thread_ts: threadTs,
    threadTs,
    botUserId: parseMentionedBotUserId(text),
  };
}

function inferThreadTs(raw: Record<string, unknown>): string | undefined {
  const directThreadTs = asOptionalString(raw.thread_ts);
  if (directThreadTs !== undefined) {
    return directThreadTs;
  }

  return asOptionalString(raw.ts);
}

function parseMentionedBotUserId(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }

  const match = text.match(/<@([A-Z0-9]+)>/);
  return match?.[1];
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
