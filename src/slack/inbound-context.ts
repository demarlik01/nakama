import type { SlackMessageEvent } from '../types.js';

const CONVERSATION_INFO_SENTINEL = 'Conversation info (untrusted metadata):';
const SENDER_INFO_SENTINEL = 'Sender (untrusted metadata):';

const INBOUND_META_SENTINELS = [
  CONVERSATION_INFO_SENTINEL,
  SENDER_INFO_SENTINEL,
];

interface InboundContextEvent extends SlackMessageEvent {
  ts?: string;
}

export function buildInboundContext(event: InboundContextEvent, type: string): string {
  const channelType = event.channelType ?? event.channel_type;
  const isDirectMessage = channelType === 'im';

  const senderId = normalizeValue(event.user);
  const senderName = senderId !== undefined ? `<@${senderId}>` : 'unknown';
  const senderPayload = pruneUndefined({
    label: senderId !== undefined ? `${senderName} (${senderId})` : senderName,
    id: senderId,
  });

  const blocks = [renderJsonBlock(SENDER_INFO_SENTINEL, senderPayload)];
  if (isDirectMessage) {
    return blocks.join('\n\n');
  }

  const messageText = normalizeValue(event.text);
  const botUserId = normalizeValue(event.botUserId);
  const threadTs = normalizeValue(event.threadTs ?? event.thread_ts);
  const messageTs = normalizeValue(event.ts);
  const channelId = normalizeValue(event.channel);
  const wasMentioned =
    messageText !== undefined &&
    botUserId !== undefined &&
    messageText.includes(`<@${botUserId}>`);

  const conversationPayload = pruneUndefined({
    message_id: messageTs,
    sender: senderName,
    sender_id: senderId,
    channel: channelId !== undefined ? `<#${channelId}>` : undefined,
    channel_id: channelId,
    thread_ts: threadTs,
    is_thread: threadTs !== undefined && threadTs !== messageTs ? true : false,
    was_mentioned: wasMentioned ? true : undefined,
    triggered_by: normalizeValue(type),
  });

  return [renderJsonBlock(CONVERSATION_INFO_SENTINEL, conversationPayload), ...blocks].join('\n\n');
}

export function sanitizeInboundSystemTags(input: string): string {
  return input
    .replace(/\[\s*(System\s*Message|System)\s*\]/gi, (_match, tag: string) => `(${tag})`)
    .replace(/^(\s*)System:(?=\s|$)/gim, '$1System (untrusted):');
}

/**
 * Escape metadata sentinel strings in user input to prevent spoofing.
 * Replaces exact sentinel text with a visually similar but non-matching version.
 */
export function escapeMetadataSentinels(input: string): string {
  let result = input;
  for (const sentinel of INBOUND_META_SENTINELS) {
    // Replace sentinel with zero-width-space-injected version to break matching
    result = result.replaceAll(sentinel, sentinel.replace('(', '(\u200B'));
  }
  return result;
}

export function stripInboundMetadata(text: string): string {
  let remaining = text;
  let strippedAny = false;

  while (true) {
    const trimmedLeading = remaining.replace(/^\s+/, '');
    let strippedCurrent = false;

    for (const sentinel of INBOUND_META_SENTINELS) {
      const stripped = stripPrefixedJsonBlock(trimmedLeading, sentinel);
      if (stripped === undefined) {
        continue;
      }

      remaining = stripped;
      strippedAny = true;
      strippedCurrent = true;
      break;
    }

    if (!strippedCurrent) {
      break;
    }
  }

  return strippedAny ? remaining.replace(/^\s+/, '') : text;
}

function renderJsonBlock(title: string, payload: Record<string, unknown>): string {
  return [title, '```json', JSON.stringify(payload, null, 2), '```'].join('\n');
}

function normalizeValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pruneUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function stripPrefixedJsonBlock(text: string, sentinel: string): string | undefined {
  const prefix = `${sentinel}\n\`\`\`json\n`;
  if (!text.startsWith(prefix)) {
    return undefined;
  }

  const endFence = '\n```';
  const endIndex = text.indexOf(endFence, prefix.length);
  if (endIndex === -1) {
    return undefined;
  }

  return text.slice(endIndex + endFence.length).replace(/^\s+/, '');
}
