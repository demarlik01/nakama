import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSearchTool } from '../src/tools/web-search.js';

describe('web_search tool', () => {
  const tool = createWebSearchTool({ braveApiKey: 'test-key-123' });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('web_search');
    expect(tool.label).toBe('Web Search');
    expect(tool.description).toContain('Brave Search');
  });

  it('should return error for empty query', async () => {
    const result = await tool.execute('t1', { query: '' } as any, undefined, undefined, undefined as any);
    expect(result.content[0]!.type).toBe('text');
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('Error');
  });

  it('should make API request with correct parameters', async () => {
    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          web: {
            results: [
              {
                title: 'Test Result',
                url: 'https://example.com',
                description: 'A test result',
              },
            ],
          },
        }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await tool.execute(
      't2',
      { query: 'test search', count: 3, country: 'US' } as any,
      undefined,
      undefined,
      undefined as any,
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = new URL(call[0] as string);
    expect(url.hostname).toBe('api.search.brave.com');
    expect(url.searchParams.get('q')).toBe('test search');
    expect(url.searchParams.get('count')).toBe('3');
    expect(url.searchParams.get('country')).toBe('US');

    const headers = call[1].headers;
    expect(headers['X-Subscription-Token']).toBe('test-key-123');

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe('Test Result');
  });

  it('should handle API errors', async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await tool.execute(
      't3',
      { query: 'test' } as any,
      undefined,
      undefined,
      undefined as any,
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('429');
  });

  it('should clamp count between 1 and 10', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ web: { results: [] } }),
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await tool.execute(
      't4',
      { query: 'test', count: 20 } as any,
      undefined,
      undefined,
      undefined as any,
    );

    const url = new URL(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string,
    );
    expect(url.searchParams.get('count')).toBe('10');
  });
});
