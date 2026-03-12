export interface MessageMetadata {
  messageId?: string;
  senderId?: string;
  sender?: string;
  timestamp?: string;
  repliedMessage?: string;
}

export interface ParsedMessage {
  text: string;
  metadata?: MessageMetadata;
  rawMetadata?: string;
}

/**
 * Regex to match untrusted metadata blocks like:
 *   Conversation info (untrusted metadata):
 *   ```json
 *   { ... }
 *   ```
 *
 * Also handles blocks without ```json fencing (raw JSON on next line).
 */
const METADATA_BLOCK_RE =
  /((?:Conversation info|Sender|Replied message)\s*\(untrusted(?:,?\s*\w+)*\):)\s*\n```(?:json)?\n([\s\S]*?)```\s*\n?/g;

/** Same pattern but with bare JSON (no fences). */
const METADATA_BLOCK_BARE_RE =
  /((?:Conversation info|Sender|Replied message)\s*\(untrusted(?:,?\s*\w+)*\):)\s*\n(\{[\s\S]*?\})\s*\n?/g;

function tryParseJSON(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseSlackMessage(content: string): ParsedMessage {
  if (!content) return { text: "" };

  const rawBlocks: string[] = [];
  const metadata: MessageMetadata = {};
  let remaining = content;

  // Try fenced blocks first, then bare JSON blocks
  for (const re of [METADATA_BLOCK_RE, METADATA_BLOCK_BARE_RE]) {
    re.lastIndex = 0;
    remaining = remaining.replace(re, (match, label: string, jsonStr: string) => {
      rawBlocks.push(match.trim());
      const parsed = tryParseJSON(jsonStr.trim());
      if (!parsed) return "";

      if (label.startsWith("Conversation info")) {
        metadata.messageId =
          (parsed.message_id as string) ?? (parsed.messageId as string);
        metadata.senderId =
          (parsed.sender_id as string) ?? (parsed.senderId as string);
        if (parsed.timestamp) {
          metadata.timestamp = String(parsed.timestamp);
        }
      } else if (label.startsWith("Sender")) {
        const labelVal = parsed.label as string | undefined;
        if (labelVal) {
          // "Hs Kim (8445286290)" → extract name
          const nameMatch = labelVal.match(/^(.+?)(?:\s*\(\d+\))?$/);
          metadata.sender = nameMatch ? nameMatch[1].trim() : labelVal;
        }
      } else if (label.startsWith("Replied message")) {
        metadata.repliedMessage = jsonStr.trim();
      }

      return "";
    });
  }

  const text = remaining.trim();

  if (rawBlocks.length === 0) {
    return { text: content };
  }

  return {
    text,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    rawMetadata: rawBlocks.join("\n\n"),
  };
}

/**
 * Detect assistant messages that are purely tool-call markers like:
 *   [Tool call: web_search]
 *   [Tool call: browser]
 */
export interface ToolCallMarker {
  toolName: string;
}

const TOOL_CALL_RE = /^\[Tool call:\s*(\w+)\]\s*$/;

export function parseToolCallMarker(content: string): ToolCallMarker | null {
  const m = content.trim().match(TOOL_CALL_RE);
  if (!m) return null;
  return { toolName: m[1] };
}
