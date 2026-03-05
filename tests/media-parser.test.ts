import { describe, expect, it } from 'vitest';

import { splitMediaFromOutput } from '../src/slack/media-parser.js';

const WORKSPACE = '/tmp/test-workspace';

describe('media-parser', () => {
  it('extracts a single MEDIA: token', () => {
    const input = '여기 파일입니다.\nMEDIA:./output/chart.png';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.text).toBe('여기 파일입니다.');
    expect(result.mediaUrls).toEqual([`${WORKSPACE}/output/chart.png`]);
  });

  it('extracts multiple MEDIA: tokens', () => {
    const input = '결과입니다.\nMEDIA:./a.png\n설명입니다.\nMEDIA:./b.pdf';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.text).toBe('결과입니다.\n설명입니다.');
    expect(result.mediaUrls).toHaveLength(2);
    expect(result.mediaUrls[0]).toContain('a.png');
    expect(result.mediaUrls[1]).toContain('b.pdf');
  });

  it('ignores MEDIA: inside fenced code blocks', () => {
    const input = [
      '예시 코드:',
      '```',
      'MEDIA:./should-be-ignored.png',
      '```',
      'MEDIA:./real-file.png',
    ].join('\n');
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.mediaUrls).toHaveLength(1);
    expect(result.mediaUrls[0]).toContain('real-file.png');
    expect(result.text).toContain('MEDIA:./should-be-ignored.png');
  });

  it('handles backtick-wrapped paths', () => {
    const input = 'MEDIA:`./output/result.csv`';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.mediaUrls).toHaveLength(1);
    expect(result.mediaUrls[0]).toContain('result.csv');
  });

  it('rejects paths with ../ traversal', () => {
    const input = 'MEDIA:../../../etc/passwd';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.mediaUrls).toHaveLength(0);
    expect(result.text).toBe('MEDIA:../../../etc/passwd');
  });

  it('rejects absolute paths outside workspace', () => {
    const input = 'MEDIA:/etc/passwd';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.mediaUrls).toHaveLength(0);
  });

  it('accepts absolute paths inside workspace', () => {
    const input = `MEDIA:${WORKSPACE}/output/file.txt`;
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.mediaUrls).toHaveLength(1);
    expect(result.mediaUrls[0]).toBe(`${WORKSPACE}/output/file.txt`);
  });

  it('returns original text when no MEDIA: tokens present', () => {
    const input = '일반 응답입니다.';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.text).toBe('일반 응답입니다.');
    expect(result.mediaUrls).toHaveLength(0);
  });

  it('handles empty input', () => {
    const result = splitMediaFromOutput('', WORKSPACE);

    expect(result.text).toBe('');
    expect(result.mediaUrls).toHaveLength(0);
  });

  it('handles MEDIA: with leading whitespace', () => {
    const input = '  MEDIA:./file.png';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.mediaUrls).toHaveLength(1);
  });

  it('rejects MEDIA: with empty path', () => {
    const input = 'MEDIA:';
    const result = splitMediaFromOutput(input, WORKSPACE);

    expect(result.mediaUrls).toHaveLength(0);
  });
});
