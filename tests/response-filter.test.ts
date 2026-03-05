import { describe, expect, it } from 'vitest';

import { filterResponse, isSilentReply } from '../src/slack/response-filter.js';

describe('response-filter', () => {
  it('detects silent replies', () => {
    expect(isSilentReply('NO_REPLY')).toBe(true);
    expect(isSilentReply('HEARTBEAT_OK')).toBe(true);
    expect(isSilentReply('   ')).toBe(true);
    expect(isSilentReply('actual response')).toBe(false);
  });

  it('suppresses NO_REPLY and HEARTBEAT_OK without media', () => {
    expect(filterResponse('NO_REPLY', false)).toEqual({
      text: '',
      shouldSend: false,
    });
    expect(filterResponse('HEARTBEAT_OK', false)).toEqual({
      text: '',
      shouldSend: false,
    });
  });

  it('allows media-only delivery when text is silent', () => {
    expect(filterResponse('NO_REPLY', true)).toEqual({
      text: '',
      shouldSend: true,
    });
    expect(filterResponse('   ', true)).toEqual({
      text: '',
      shouldSend: true,
    });
  });

  it('passes through normal responses', () => {
    expect(filterResponse('작업 완료했습니다.', false)).toEqual({
      text: '작업 완료했습니다.',
      shouldSend: true,
    });
  });
});
