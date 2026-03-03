import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, basename } from 'node:path';

import type { AgentDefinition, AppConfig, SlackMessageEvent } from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { MessageRouter } from '../core/router.js';
import { markdownToBlocks, markdownToPlainText, splitBlocksForSlack } from './block-kit.js';

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
  async postMessage(
    channelId: string,
    text: string,
    threadTs?: string,
    agent?: AgentDefinition,
  ): Promise<void> {
    const client = this.getClient();
    const identityOverrides = this.getMessageIdentityOverrides(agent);

    try {
      const blocks = markdownToBlocks(text);
      const blockChunks = splitBlocksForSlack(blocks);
      const plainFallback = markdownToPlainText(text);
      const textChunks = splitMessage(plainFallback, SLACK_MAX_MESSAGE_LENGTH);

      for (let i = 0; i < blockChunks.length; i++) {
        await this.postMessageWithIdentityFallback(
          client,
          {
            channel: channelId,
            text: textChunks[i] ?? plainFallback.slice(0, SLACK_MAX_MESSAGE_LENGTH),
            blocks: blockChunks[i] as any[],
            ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
          },
          identityOverrides,
        );
      }
    } catch {
      // Fallback to plain text
      const chunks = splitMessage(text, SLACK_MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        await this.postMessageWithIdentityFallback(
          client,
          {
            channel: channelId,
            text: chunk,
            ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
          },
          identityOverrides,
        );
      }
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

    app.event('reaction_added', async ({ event, client }) => {
      await this.handleReactionAdded(
        event as unknown as Record<string, unknown>,
        client,
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

      await this.replyToSlack(client, say, normalized.channel, response, threadTs, route.agent);

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
      await this.replyToSlack(
        client,
        say,
        normalized.channel,
        errorMessage,
        threadTs,
        route.agent,
      ).catch((sayErr) => {
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

  /**
   * Handle reaction_added events.
   * If the reaction matches an agent's reactionTriggers, fetch the message
   * and route it to the agent for processing.
   */
  private async handleReactionAdded(
    rawEvent: Record<string, unknown>,
    client: WebClient,
  ): Promise<void> {
    const reaction = asOptionalString(rawEvent.reaction);
    const userId = asOptionalString(rawEvent.user);
    const itemUser = asOptionalString(rawEvent.item_user);
    const item = rawEvent.item as Record<string, unknown> | undefined;

    if (!reaction || !item || !userId) return;

    const channel = asOptionalString(item.channel);
    const messageTs = asOptionalString(item.ts);
    if (!channel || !messageTs) return;

    // Find agents that have this reaction as a trigger
    const agents = this.router.getAllAgents?.();
    if (!agents) return;

    for (const agent of agents) {
      if (!agent.reactionTriggers?.includes(reaction)) continue;

      // Fetch the original message
      try {
        const result = await client.conversations.history({
          channel,
          latest: messageTs,
          inclusive: true,
          limit: 1,
        });

        const originalMessage = result.messages?.[0];
        if (!originalMessage || typeof originalMessage.text !== 'string') continue;

        this.logger.info('Reaction trigger matched', {
          agentId: agent.id,
          reaction,
          channel,
        });

        // Add eyes reaction to acknowledge
        await addReaction(client, channel, messageTs, 'eyes').catch(() => {});

        const response = await this.sessionManager.handleMessage(
          agent.id,
          `[Triggered by :${reaction}: reaction on message]

${originalMessage.text}`,
          {
            slackChannelId: channel,
            slackThreadTs: messageTs,
            slackUserId: userId,
          },
        );

        // Post response in thread
        const blocks = markdownToBlocks(response);
        const blockChunks = splitBlocksForSlack(blocks);
        const plainFallback = markdownToPlainText(response);
        const textChunks = splitMessage(plainFallback, SLACK_MAX_MESSAGE_LENGTH);
        const identityOverrides = this.getMessageIdentityOverrides(agent);

        for (let i = 0; i < blockChunks.length; i++) {
          await this.postMessageWithIdentityFallback(
            client,
            {
              channel,
              text: textChunks[i] ?? plainFallback.slice(0, SLACK_MAX_MESSAGE_LENGTH),
              blocks: blockChunks[i] as any[],
              thread_ts: messageTs,
            },
            identityOverrides,
          );
        }

        await removeReaction(client, channel, messageTs, 'eyes').catch(() => {});
        await addReaction(client, channel, messageTs, 'white_check_mark').catch(() => {});
      } catch (error) {
        this.logger.error('Error handling reaction trigger', {
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await removeReaction(client, channel, messageTs, 'eyes').catch(() => {});
        await addReaction(client, channel, messageTs, 'x').catch(() => {});
      }
    }
  }

  private async replyToSlack(
    client: WebClient,
    say: SayLike,
    channelId: string | undefined,
    text: string,
    threadTs?: string,
    agent?: AgentDefinition,
  ): Promise<void> {
    const identityOverrides = this.getMessageIdentityOverrides(agent);

    // Try Block Kit formatting, fall back to plain text
    try {
      const blocks = markdownToBlocks(text);
      const blockChunks = splitBlocksForSlack(blocks);
      const plainFallback = markdownToPlainText(text);
      const textChunks = splitMessage(plainFallback, SLACK_MAX_MESSAGE_LENGTH);

      for (let i = 0; i < blockChunks.length; i++) {
        const payload: {
          text: string;
          blocks?: unknown[];
          thread_ts?: string;
        } = {
          text: textChunks[i] ?? plainFallback.slice(0, SLACK_MAX_MESSAGE_LENGTH),
          blocks: blockChunks[i],
        };
        if (threadTs !== undefined) {
          payload.thread_ts = threadTs;
        }

        if (channelId !== undefined) {
          await this.postMessageWithIdentityFallback(
            client,
            {
              channel: channelId,
              ...payload,
            },
            identityOverrides,
          );
        } else {
          await say(payload as unknown as SayPayload);
        }
      }
    } catch {
      // Fallback to plain text
      const chunks = splitMessage(text, SLACK_MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        if (channelId !== undefined) {
          await this.postMessageWithIdentityFallback(
            client,
            {
              channel: channelId,
              text: chunk,
              ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
            },
            identityOverrides,
          );
          continue;
        }

        if (threadTs !== undefined) {
          await say({ text: chunk, thread_ts: threadTs });
        } else {
          await say(chunk);
        }
      }
    }
  }

  private async postMessageWithIdentityFallback(
    client: WebClient,
    payload: Record<string, unknown>,
    identityOverrides: {
      username?: string;
      icon_emoji?: string;
    },
  ): Promise<void> {
    if (!hasIdentityOverrides(identityOverrides)) {
      await client.chat.postMessage(payload as any);
      return;
    }

    try {
      await client.chat.postMessage({
        ...(payload as Record<string, unknown>),
        ...identityOverrides,
      } as any);
    } catch (error) {
      if (!isIdentityOverrideRejected(error)) {
        throw error;
      }

      this.logger.warn('Slack identity override rejected; retrying with default bot profile', {
        slackError: extractSlackErrorCode(error),
      });

      await client.chat.postMessage(payload as any);
    }
  }

  private getMessageIdentityOverrides(
    agent?: Pick<AgentDefinition, 'slackDisplayName' | 'slackIcon'>,
  ): {
    username?: string;
    icon_emoji?: string;
  } {
    const username = normalizeSlackUsername(agent?.slackDisplayName);
    const iconEmoji = normalizeSlackIconEmoji(agent?.slackIcon);

    return {
      ...(username !== undefined ? { username } : {}),
      ...(iconEmoji !== undefined ? { icon_emoji: iconEmoji } : {}),
    };
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

function hasIdentityOverrides(overrides: {
  username?: string;
  icon_emoji?: string;
}): boolean {
  return overrides.username !== undefined || overrides.icon_emoji !== undefined;
}

function normalizeSlackUsername(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // Remove control characters to avoid invalid payloads and log/header injection.
  const sanitized = trimmed.replace(/[\u0000-\u001F\u007F]/g, '');
  if (sanitized.length === 0) {
    return undefined;
  }

  return sanitized.slice(0, SLACK_MAX_USERNAME_LENGTH);
}

function normalizeSlackIconEmoji(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (!SLACK_ICON_EMOJI_PATTERN.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function isIdentityOverrideRejected(error: unknown): boolean {
  const code = extractSlackErrorCode(error);
  if (code === undefined) {
    return false;
  }

  return IDENTITY_OVERRIDE_RETRYABLE_ERRORS.has(code);
}

function extractSlackErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const data = (error as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const code = (data as { error?: unknown }).error;
  return typeof code === 'string' ? code : undefined;
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

const IDENTITY_OVERRIDE_RETRYABLE_ERRORS = new Set([
  'invalid_arg_name',
  'invalid_arg_value',
  'invalid_arguments',
  'missing_scope',
  'not_allowed_token_type',
  'restricted_action',
]);

const SLACK_ICON_EMOJI_PATTERN = /^:[a-zA-Z0-9_+-]+:$/;
const SLACK_MAX_USERNAME_LENGTH = 80;
