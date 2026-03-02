import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, basename } from 'node:path';

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
  private connected = false;

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
      logLevel: LogLevel.INFO,
    });

    this.registerEventHandlers(this.app);
    await this.app.start();
    this.connected = true;

    this.logger.info('Slack gateway started');
  }

  async stop(): Promise<void> {
    if (this.app === undefined) {
      return;
    }

    await this.app.stop();
    this.connected = false;
    this.app = undefined;

    this.logger.info('Slack gateway stopped');
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Upload a file to a Slack channel (bot → Slack).
   * Requires `files:write` scope on the bot token.
   */
  async uploadFile(
    channelId: string,
    filePath: string,
    options?: { threadTs?: string; title?: string; comment?: string },
  ): Promise<void> {
    const client = this.getClient();
    const filename = options?.title ?? basename(filePath);

    // Slack files.uploadV2 is the modern approach
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploadArgs: Record<string, unknown> = {
      channel_id: channelId,
      file: filePath,
      filename,
      title: filename,
    };
    if (options?.comment) uploadArgs.initial_comment = options.comment;
    if (options?.threadTs) uploadArgs.thread_ts = options.threadTs;
    await client.filesUploadV2(uploadArgs as any);

    this.logger.info('File uploaded to Slack', { channelId, filePath, filename });
  }

  /**
   * Post a text message to a Slack channel.
   * Used by schedulers (heartbeat, cron) to deliver agent responses.
   */
  async postMessage(channelId: string, text: string, threadTs?: string): Promise<void> {
    const client = this.getClient();
    const chunks = splitMessage(text, SLACK_MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      await client.chat.postMessage({
        channel: channelId,
        text: chunk,
        ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
      });
    }
  }

  private getClient(): WebClient {
    if (this.app === undefined) {
      throw new Error('SlackGateway not started');
    }
    return this.app.client;
  }

  private registerEventHandlers(app: App): void {
    app.event('app_mention', async ({ event, say, client }) => {
      await this.handleSlackEvent(
        event as unknown as Record<string, unknown>,
        say as SayLike,
        client,
        'app_mention',
      );
    });

    app.event('message', async ({ event, say, client }) => {
      const genericEvent = event as unknown as Record<string, unknown>;
      if (typeof genericEvent.subtype === 'string' && genericEvent.subtype !== 'file_share') {
        return;
      }

      await this.handleSlackEvent(genericEvent, say as SayLike, client, 'message');
    });
  }

  private async handleSlackEvent(
    rawEvent: Record<string, unknown>,
    say: SayLike,
    client: WebClient,
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
    const channel = normalized.channel ?? '';
    const messageTs = asOptionalString(rawEvent.ts);

    // 👀 Reaction: acknowledge receipt
    if (channel && messageTs) {
      await addReaction(client, channel, messageTs, 'eyes').catch((err) => {
        this.logger.warn('Failed to add eyes reaction', { error: String(err) });
      });
    }

    try {
      // Download attached files if present
      // Requires `files:read` scope on the bot token
      const filePaths = await this.downloadAttachedFiles(
        client,
        rawEvent,
        route.agent.workspacePath,
      );

      // Build message text, appending file paths if any
      let messageText = normalized.text ?? '';
      if (filePaths.length > 0) {
        const fileList = filePaths.map((p) => `- ${p}`).join('\n');
        messageText += `\n\n[Attached files downloaded to agent workspace]\n${fileList}`;
      }

      const response = await this.sessionManager.handleMessage(
        route.agent.id,
        messageText,
        {
          slackChannelId: channel,
          slackThreadTs: threadTs,
          slackUserId: normalized.user ?? 'unknown',
        },
      );

      await this.replyToSlack(say, response, threadTs);

      // ✅ Reaction: success
      if (channel && messageTs) {
        await removeReaction(client, channel, messageTs, 'eyes').catch(() => {});
        await addReaction(client, channel, messageTs, 'white_check_mark').catch((err) => {
          this.logger.warn('Failed to add check reaction', { error: String(err) });
        });
      }
    } catch (error) {
      // ❌ Reaction: error
      if (channel && messageTs) {
        await removeReaction(client, channel, messageTs, 'eyes').catch(() => {});
        await addReaction(client, channel, messageTs, 'x').catch((err) => {
          this.logger.warn('Failed to add x reaction', { error: String(err) });
        });
      }

      this.logger.error('Error handling Slack event', {
        agentId: route.agent.id,
        error: error instanceof Error ? error.message : String(error),
      });

      // Send user-friendly error message
      const errorMessage = '죄송합니다, 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      await this.replyToSlack(say, errorMessage, threadTs).catch((sayErr) => {
        this.logger.error('Failed to send error message to user', {
          error: String(sayErr),
        });
      });
    }
  }

  /**
   * Download files attached to a Slack message into the agent workspace.
   * Requires `files:read` scope on the bot token.
   */
  private async downloadAttachedFiles(
    client: WebClient,
    rawEvent: Record<string, unknown>,
    workspacePath: string,
  ): Promise<string[]> {
    const files = rawEvent.files;
    if (!Array.isArray(files) || files.length === 0) {
      return [];
    }

    const downloadDir = join(workspacePath, 'uploads');
    await mkdir(downloadDir, { recursive: true });

    const downloaded: string[] = [];

    for (const file of files) {
      const f = file as Record<string, unknown>;
      const url = asOptionalString(f.url_private);
      const name = asOptionalString(f.name) ?? `file_${Date.now()}`;

      if (url === undefined) {
        this.logger.warn('File missing url_private, skipping', { name });
        continue;
      }

      // Sanitize filename to prevent path traversal
      const safeName = name.replace(/[/\\]/g, '_').replace(/^\.+/, '');
      const destPath = join(downloadDir, safeName);
      // Double-check resolved path stays within downloadDir
      if (!destPath.startsWith(downloadDir)) {
        this.logger.warn('Path traversal attempt blocked', { name });
        continue;
      }

      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.slack.botToken}`,
          },
        });

        if (!response.ok || response.body === null) {
          this.logger.warn('Failed to download file', { name, status: response.status });
          continue;
        }

        // Check for existing symlink (prevent symlink-based path traversal)
        try {
          const stat = await import('fs/promises').then(fs => fs.lstat(destPath));
          if (stat.isSymbolicLink()) {
            this.logger.warn('Symlink detected at download path, skipping', { destPath });
            continue;
          }
        } catch {
          // File doesn't exist yet — safe to write
        }

        const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
        await pipeline(nodeStream, createWriteStream(destPath, { flags: 'wx' }));

        downloaded.push(destPath);
        this.logger.info('Downloaded attached file', { name, destPath });
      } catch (err) {
        this.logger.warn('Error downloading file', { name, error: String(err) });
      }
    }

    return downloaded;
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

async function addReaction(
  client: WebClient,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  await client.reactions.add({ channel, timestamp, name });
}

async function removeReaction(
  client: WebClient,
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  await client.reactions.remove({ channel, timestamp, name });
}

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

    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex <= 0 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex <= 0) {
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
