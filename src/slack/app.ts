import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, basename } from 'node:path';

import type { AgentDefinition, AppConfig, SlackBlock, SlackMessageEvent } from '../types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import type { MessageRouter } from '../core/router.js';
import type { AgentRegistry } from '../core/registry.js';
import { markdownToBlocks, markdownToPlainText, splitBlocksForSlack } from './block-kit.js';
import { registerCommands } from './commands.js';
import { buildInboundContext, escapeMetadataSentinels, sanitizeInboundSystemTags } from './inbound-context.js';
import { filterResponse } from './response-filter.js';
import { splitMediaFromOutput } from './media-parser.js';
import {
  processSlackFile,
  isProcessedImage,
  isProcessedTextFile,
  type SlackFile,
  type ProcessedImage,
} from './image-handler.js';

import type { SessionManager } from '../core/session.js';

interface SayPayload {
  text: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
}

type SayLike = (message: string | SayPayload) => Promise<unknown>;

export class SlackGateway {
  private app?: App;
  private connected = false;
  private readonly proactiveLastResponseAtByChannel = new Map<string, number>();
  private readonly proactiveSeenMessageKeys = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly router: MessageRouter,
    private readonly sessionManager: SessionManager,
    private readonly registry: AgentRegistry,
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
    registerCommands(app, this.registry);

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

    const isChannelMessage = (type === 'message' || type === 'app_mention') && normalized.channelType !== 'im';
    const isNewChannelThreadStart =
      isChannelMessage &&
      normalized.channel !== undefined &&
      normalized.threadTs === undefined &&
      normalized.thread_ts === undefined;

    const incomingThreadTs = route.threadTs ?? normalized.threadTs ?? normalized.thread_ts;
    const threadTs = incomingThreadTs ?? inferThreadTs(rawEvent);

    if (route.type === 'concierge') {
      await this.replyBlocksToSlack(client, say, normalized.channel, route.response, threadTs);
      return;
    }

    if (isNewChannelThreadStart && threadTs !== undefined) {
      this.registry.registerThread(threadTs, route.agent.id);
    }

    const channel = normalized.channel ?? '';
    const messageTs = asOptionalString(rawEvent.ts);

    const isProactiveChannelMessage =
      type === 'message' &&
      normalized.channelType !== 'im' &&
      normalized.threadTs === undefined &&
      normalized.thread_ts === undefined &&
      channel.length > 0 &&
      getAgentChannelMode(route.agent, channel) === 'proactive';

    if (isProactiveChannelMessage) {
      if (this.shouldSkipProactiveMessage(rawEvent, normalized, route.agent, channel, messageTs)) {
        return;
      }
    }

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

      // Process files for multimodal vision (images → content blocks, text → inline tags)
      const { imageContents, textFileTags } = await this.processFilesForVision(
        rawEvent,
        this.config.slack.botToken,
      );

      const botUserId = route.agent.slackBotUserId;
      let userMessageText = botUserId
        ? stripBotMention(normalized.text ?? '', botUserId)
        : (normalized.text ?? '');
      userMessageText = sanitizeInboundSystemTags(userMessageText);
      userMessageText = escapeMetadataSentinels(userMessageText);

      // Append downloaded file paths
      if (filePaths.length > 0) {
        const fileList = filePaths.map((p) => `- ${p}`).join('\n');
        userMessageText += `\n\n[Attached files downloaded to agent workspace]\n${fileList}`;
      }

      // Append text file contents inline
      if (textFileTags.length > 0) {
        userMessageText += '\n\n' + textFileTags.join('\n\n');
      }

      const inboundContext = buildInboundContext(
        {
          ...normalized,
          ts: messageTs,
          botUserId,
        },
        type,
      );
      const messageSections = inboundContext.length > 0 ? [inboundContext] : [];

      if (isNewChannelThreadStart && channel.length > 0) {
        const recentContext = await this.buildRecentChannelContext(client, channel, messageTs);
        if (recentContext !== undefined) {
          messageSections.push(recentContext);
        }
      }
      messageSections.push(userMessageText);
      const messageText = messageSections.join('\n\n');

      const images = imageContents.map((img) => img.content);
      const response = await this.sessionManager.handleMessage(
        route.agent.id,
        messageText,
        {
          slackChannelId: channel,
          slackThreadTs: threadTs,
          slackUserId: normalized.user ?? 'unknown',
        },
        images.length > 0 ? images : undefined,
      );

      // Parse MEDIA: tokens from LLM response
      const { text: textWithoutMedia, mediaUrls } = splitMediaFromOutput(
        response,
        route.agent.workspacePath,
      );
      const hasMedia = mediaUrls.length > 0;
      const filteredResponse = filterResponse(textWithoutMedia, hasMedia);

      if (filteredResponse.shouldSend && filteredResponse.text.length > 0) {
        await this.replyToSlack(
          client,
          say,
          normalized.channel,
          filteredResponse.text,
          threadTs,
          route.agent,
        );
      }

      // Upload media files to Slack
      if (hasMedia && channel) {
        for (const mediaPath of mediaUrls) {
          try {
            await this.uploadFile(channel, mediaPath, { threadTs });
          } catch (uploadErr) {
            this.logger.warn('Failed to upload media file', {
              path: mediaPath,
              error: String(uploadErr),
            });
          }
        }
      }

      // ✅ Reaction: success
      if (channel && messageTs) {
        await removeReaction(client, channel, messageTs, 'eyes').catch(() => {});
        if (filteredResponse.shouldSend) {
          await addReaction(client, channel, messageTs, 'white_check_mark').catch((err) => {
            this.logger.warn('Failed to add check reaction', { error: String(err) });
          });
        }
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

      // Send error message with debug info to user channel
      const errorDetail = sanitizeErrorForUser(
        error instanceof Error ? error.message : String(error),
      );
      const errorMessage = [
        ':rotating_light: *에러가 발생했습니다*',
        `• *Agent:* ${route.agent.displayName} (\`${route.agent.id}\`)`,
        `• *Error:* ${errorDetail}`,
        `• *Time:* ${new Date().toISOString()}`,
      ].join('\n');
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

  private shouldSkipProactiveMessage(
    rawEvent: Record<string, unknown>,
    normalized: SlackMessageEvent,
    agent: AgentDefinition,
    channelId: string,
    messageTs: string | undefined,
  ): boolean {
    if (this.isBotOrSelfMessage(rawEvent, normalized, agent)) {
      this.logger.debug('Skipping proactive route for bot/self message', {
        channelId,
        user: normalized.user,
      });
      return true;
    }

    const messageKey =
      messageTs !== undefined && messageTs.length > 0 ? `${channelId}:${messageTs}` : undefined;
    if (messageKey !== undefined && this.proactiveSeenMessageKeys.has(messageKey)) {
      this.logger.debug('Skipping proactive route for duplicate message ts', {
        channelId,
        messageTs,
      });
      return true;
    }

    const now = Date.now();
    const minIntervalSec = getProactiveMinIntervalSec(agent);
    const minIntervalMs = minIntervalSec * 1000;
    const lastAt = this.proactiveLastResponseAtByChannel.get(channelId);

    if (lastAt !== undefined && now - lastAt < minIntervalMs) {
      this.logger.debug('Skipping proactive route due to minimum interval guard', {
        channelId,
        minIntervalSec,
        elapsedMs: now - lastAt,
      });
      return true;
    }

    this.proactiveLastResponseAtByChannel.set(channelId, now);
    if (messageKey !== undefined) {
      this.proactiveSeenMessageKeys.add(messageKey);
    }
    return false;
  }

  private isBotOrSelfMessage(
    rawEvent: Record<string, unknown>,
    normalized: SlackMessageEvent,
    agent: AgentDefinition,
  ): boolean {
    const subtype = asOptionalString(rawEvent.subtype);
    if (subtype === 'bot_message') {
      return true;
    }

    if (asOptionalString(rawEvent.bot_id) !== undefined) {
      return true;
    }

    if (agent.slackBotUserId !== undefined && normalized.user === agent.slackBotUserId) {
      return true;
    }

    return false;
  }

  private async buildRecentChannelContext(
    client: WebClient,
    channelId: string,
    messageTs: string | undefined,
  ): Promise<string | undefined> {
    try {
      const history = await client.conversations.history({
        channel: channelId,
        ...(messageTs !== undefined ? { latest: messageTs, inclusive: false } : {}),
        limit: RECENT_CHANNEL_CONTEXT_FETCH_LIMIT,
      });

      const recentMessages = (history.messages ?? [])
        .map((message) => {
          const record = message as Record<string, unknown>;
          const text = asOptionalString(record.text);
          if (text === undefined || text.trim().length === 0) {
            return undefined;
          }

          const ts = asOptionalString(record.ts);
          const threadTs = asOptionalString(record.thread_ts);
          if (threadTs !== undefined && ts !== threadTs) {
            return undefined;
          }

          const user = asOptionalString(record.user);
          const username = asOptionalString(record.username);
          return {
            speaker: user !== undefined ? `<@${user}>` : username ?? 'unknown',
            text: text.replace(/\s+/g, ' ').trim().slice(0, RECENT_CHANNEL_CONTEXT_TEXT_LIMIT),
          };
        })
        .filter(
          (item): item is { speaker: string; text: string } =>
            item !== undefined && item.text.length > 0,
        )
        .slice(0, RECENT_CHANNEL_CONTEXT_LINE_LIMIT)
        .reverse();

      if (recentMessages.length === 0) {
        return undefined;
      }

      const lines = recentMessages.map((entry) => `- ${entry.speaker}: ${entry.text}`).join('\n');
      return `## Recent Channel Messages\n${lines}`;
    } catch (error) {
      this.logger.warn('Failed to fetch recent channel context', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
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
   * Process Slack message files for multimodal vision.
   * Returns image content blocks and text file tags.
   */
  private async processFilesForVision(
    rawEvent: Record<string, unknown>,
    botToken: string,
  ): Promise<{
    imageContents: ProcessedImage[];
    textFileTags: string[];
  }> {
    const files = rawEvent.files;
    if (!Array.isArray(files) || files.length === 0) {
      return { imageContents: [], textFileTags: [] };
    }

    const imageContents: ProcessedImage[] = [];
    const textFileTags: string[] = [];

    for (const file of files) {
      const slackFile = file as SlackFile;
      try {
        const processed = await processSlackFile(slackFile, botToken);
        if (processed === null) continue;

        if (isProcessedImage(processed)) {
          imageContents.push(processed);
        } else if (isProcessedTextFile(processed)) {
          textFileTags.push(processed.tag);
        }
      } catch (err) {
        this.logger.warn('Failed to process file for vision', {
          name: slackFile.name,
          error: String(err),
        });
      }
    }

    return { imageContents, textFileTags };
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

        // Filter silent responses (NO_REPLY, HEARTBEAT_OK, empty)
        const filteredResponse = filterResponse(response, false);
        if (!filteredResponse.shouldSend) {
          await removeReaction(client, channel, messageTs, 'eyes').catch(() => {});
          continue;
        }

        // Post response in thread
        const blocks = markdownToBlocks(filteredResponse.text);
        const blockChunks = splitBlocksForSlack(blocks);
        const plainFallback = markdownToPlainText(filteredResponse.text);
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

  private async replyBlocksToSlack(
    client: WebClient,
    say: SayLike,
    channelId: string | undefined,
    blocks: SlackBlock[],
    threadTs?: string,
  ): Promise<void> {
    const payload: {
      text: string;
      blocks: SlackBlock[];
      thread_ts?: string;
    } = {
      text: '이 채널에 배정된 에이전트가 없습니다.',
      blocks,
    };
    if (threadTs !== undefined) {
      payload.thread_ts = threadTs;
    }

    if (channelId !== undefined) {
      await this.postMessageWithIdentityFallback(client, {
        channel: channelId,
        ...payload,
      }, {});
      return;
    }

    await say(payload);
  }

  private async postMessageWithIdentityFallback(
    client: WebClient,
    payload: Record<string, unknown>,
    identityOverrides: {
      username?: string;
      icon_emoji?: string;
      icon_url?: string;
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
    icon_url?: string;
  } {
    const username = normalizeSlackUsername(agent?.slackDisplayName);
    const iconOverride = resolveSlackIcon(agent?.slackIcon);

    return {
      ...(username !== undefined ? { username } : {}),
      ...iconOverride,
    };
  }
}

const SLACK_MAX_MESSAGE_LENGTH = 4000;
const RECENT_CHANNEL_CONTEXT_FETCH_LIMIT = 10;
const RECENT_CHANNEL_CONTEXT_LINE_LIMIT = 8;
const RECENT_CHANNEL_CONTEXT_TEXT_LIMIT = 280;
const DEFAULT_PROACTIVE_RESPONSE_MIN_INTERVAL_SEC = 60;

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
  icon_url?: string;
}): boolean {
  return overrides.username !== undefined || overrides.icon_emoji !== undefined || overrides.icon_url !== undefined;
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

function isSlackIconUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

function resolveSlackIcon(
  value: string | undefined,
): { icon_emoji: string } | { icon_url: string } | Record<string, never> {
  if (value === undefined) {
    return {};
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }

  if (isSlackIconUrl(trimmed)) {
    return { icon_url: trimmed };
  }

  const emoji = normalizeSlackIconEmoji(trimmed);
  if (emoji !== undefined) {
    return { icon_emoji: emoji };
  }

  return {};
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

function stripBotMention(text: string, botUserId: string | undefined): string {
  if (botUserId === undefined || botUserId.length === 0) {
    return text.trim();
  }

  const mentionPattern = new RegExp(`<@${escapeRegExp(botUserId)}>`, 'g');
  return text.replace(mentionPattern, '').trim();
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getAgentChannelMode(agent: AgentDefinition, channelId: string): 'mention' | 'proactive' {
  return agent.channels[channelId]?.mode ?? 'mention';
}

function getProactiveMinIntervalSec(agent: AgentDefinition): number {
  const value = agent.limits?.proactiveResponseMinIntervalSec;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  return DEFAULT_PROACTIVE_RESPONSE_MIN_INTERVAL_SEC;
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

const MAX_USER_ERROR_LENGTH = 200;

/** Strip internal paths and truncate error messages for user-facing display. */
function sanitizeErrorForUser(raw: string): string {
  // Mask absolute file paths (e.g. /Users/foo/bar/src/file.ts → .../src/file.ts)
  let sanitized = raw.replace(/\/(?:Users|home|var|tmp)\/[^\s:]+/g, (match) => {
    const parts = match.split('/');
    return `.../${parts.slice(-2).join('/')}`;
  });
  if (sanitized.length > MAX_USER_ERROR_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_USER_ERROR_LENGTH)}…`;
  }
  return sanitized;
}
