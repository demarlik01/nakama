import { describe, expect, it } from 'vitest';

import { parseDurationMs, formatDurationMs } from '../src/utils/duration.js';

describe('parseDurationMs', () => {
  it('parses milliseconds', () => {
    expect(parseDurationMs('500ms')).toBe(500);
  });

  it('parses seconds', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseDurationMs('5m')).toBe(300_000);
    expect(parseDurationMs('30m')).toBe(1_800_000);
  });

  it('parses hours', () => {
    expect(parseDurationMs('1h')).toBe(3_600_000);
    expect(parseDurationMs('2h')).toBe(7_200_000);
  });

  it('parses days', () => {
    expect(parseDurationMs('1d')).toBe(86_400_000);
  });

  it('handles whitespace', () => {
    expect(parseDurationMs('  30m  ')).toBe(1_800_000);
  });

  it('is case insensitive', () => {
    expect(parseDurationMs('30M')).toBe(1_800_000);
    expect(parseDurationMs('1H')).toBe(3_600_000);
  });

  it('throws on invalid input', () => {
    expect(() => parseDurationMs('abc')).toThrow();
    expect(() => parseDurationMs('')).toThrow();
  });

  it('returns default on invalid input when provided', () => {
    expect(parseDurationMs('invalid', 60_000)).toBe(60_000);
  });
});

describe('formatDurationMs', () => {
  it('formats milliseconds', () => {
    expect(formatDurationMs(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDurationMs(30_000)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatDurationMs(300_000)).toBe('5m');
  });

  it('formats hours', () => {
    expect(formatDurationMs(3_600_000)).toBe('1.0h');
  });
});
