import { describe, expect, it } from 'vitest';

import { normalizeAnthropicAuthorizationInput } from '../src/cli/auth.js';

describe('normalizeAnthropicAuthorizationInput', () => {
  it('keeps code#state format unchanged', () => {
    expect(normalizeAnthropicAuthorizationInput('abc123#state456')).toBe('abc123#state456');
  });

  it('extracts code and state from a full redirect URL', () => {
    expect(
      normalizeAnthropicAuthorizationInput(
        'https://console.anthropic.com/oauth/code/callback?code=abc123&state=state456',
      ),
    ).toBe('abc123#state456');
  });

  it('extracts code and state from a pasted query string', () => {
    expect(normalizeAnthropicAuthorizationInput('code=abc123&state=state456')).toBe(
      'abc123#state456',
    );
  });

  it('falls back to the trimmed raw input when only a code is provided', () => {
    expect(normalizeAnthropicAuthorizationInput('  abc123  ')).toBe('abc123');
  });
});
