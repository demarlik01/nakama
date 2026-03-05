import { createLogger } from '../utils/logger.js';

const SILENT_REPLY_TOKENS = new Set(['NO_REPLY', 'HEARTBEAT_OK']);
const logger = createLogger('ResponseFilter');

type FilterReason = 'NO_REPLY' | 'HEARTBEAT_OK' | 'empty' | 'pass';

export interface FilteredResponse {
  text: string;
  shouldSend: boolean;
}

export function isSilentReply(text: string): boolean {
  return classifyFilterReason(text) !== 'pass';
}

export function filterResponse(text: string, hasMedia: boolean): FilteredResponse {
  const reason = classifyFilterReason(text);
  const filtered = reason !== 'pass';
  const output: FilteredResponse =
    filtered
      ? {
          text: '',
          shouldSend: hasMedia,
        }
      : {
          text,
          shouldSend: true,
        };

  logger.debug('Response filter evaluated', {
    filtered,
    reason,
    hasMedia,
    inputLength: text.length,
    outputLength: output.text.length,
    shouldSend: output.shouldSend,
  });

  return output;
}

function classifyFilterReason(text: string): FilterReason {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 'empty';
  }

  const upper = normalized.toUpperCase();
  if (upper === 'NO_REPLY') {
    return 'NO_REPLY';
  }

  if (upper === 'HEARTBEAT_OK') {
    return 'HEARTBEAT_OK';
  }

  if (SILENT_REPLY_TOKENS.has(upper)) {
    return upper === 'NO_REPLY' ? 'NO_REPLY' : 'HEARTBEAT_OK';
  }

  return 'pass';
}
