const SILENT_REPLY_TOKENS = new Set(['NO_REPLY', 'HEARTBEAT_OK']);

export interface FilteredResponse {
  text: string;
  shouldSend: boolean;
}

export function isSilentReply(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return true;
  }

  return SILENT_REPLY_TOKENS.has(normalized.toUpperCase());
}

export function filterResponse(text: string, hasMedia: boolean): FilteredResponse {
  if (isSilentReply(text)) {
    return {
      text: '',
      shouldSend: hasMedia,
    };
  }

  return {
    text,
    shouldSend: true,
  };
}
