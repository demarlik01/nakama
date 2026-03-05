const DURATION_REGEX = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration string like "30m", "1h", "5s" into milliseconds.
 * Throws on invalid input unless a default is provided.
 */
export function parseDurationMs(raw: string, defaultMs?: number): number {
  const match = raw.trim().match(DURATION_REGEX);
  if (!match) {
    if (defaultMs !== undefined) return defaultMs;
    throw new Error(`Invalid duration string: "${raw}"`);
  }
  const value = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  const multiplier = UNIT_MS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit: "${unit}"`);
  }
  return Math.round(value * multiplier);
}

/**
 * Format milliseconds as a human-readable duration string.
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}
