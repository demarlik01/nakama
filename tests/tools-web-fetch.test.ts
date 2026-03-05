import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebFetchTool } from '../src/tools/web-fetch.js';

describe('web_fetch tool', () => {
  const tool = createWebFetchTool();

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('web_fetch');
    expect(tool.label).toBe('Web Fetch');
    expect(tool.description).toContain('readable content');
  });

  it('should return error for empty url', async () => {
    const result = await tool.execute('t1', { url: '' } as any, undefined, undefined, undefined as any);
    expect((result.content[0] as { text: string }).text).toContain('Error');
  });

  it('should return error for invalid url', async () => {
    const result = await tool.execute('t1', { url: 'not-a-url' } as any, undefined, undefined, undefined as any);
    expect((result.content[0] as { text: string }).text).toContain('invalid URL');
  });

  it('should fetch and extract content from HTML', async () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <article>
            <h1>Hello World</h1>
            <p>This is a test paragraph with enough content to be extracted by readability.</p>
            <p>Another paragraph with more content to make the article long enough for parsing.</p>
            <p>And a third paragraph to ensure the content is substantial enough.</p>
            <p>More content here to make sure readability considers this a proper article.</p>
            <p>Even more content for the article to be properly parsed by the readability library.</p>
          </article>
        </body>
      </html>
    `;

    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers,
      text: () => Promise.resolve(html),
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await tool.execute(
      't2',
      { url: 'https://example.com/article' } as any,
      undefined,
      undefined,
      undefined as any,
    );

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('https://example.com/article');
  });

  it('should handle HTTP errors', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await tool.execute(
      't3',
      { url: 'https://example.com/missing' } as any,
      undefined,
      undefined,
      undefined as any,
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('404');
  });

  it('should truncate content to maxChars', async () => {
    const longContent = 'a'.repeat(1000);
    const html = `<html><body><p>${longContent}</p></body></html>`;

    const headers = new Headers({ 'content-type': 'text/html' });
    const mockResponse = {
      ok: true,
      headers,
      text: () => Promise.resolve(html),
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await tool.execute(
      't4',
      { url: 'https://example.com', maxChars: 100 } as any,
      undefined,
      undefined,
      undefined as any,
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('[truncated]');
  });

  it('should handle fetch errors', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const result = await tool.execute(
      't5',
      { url: 'https://example.com' } as any,
      undefined,
      undefined,
      undefined as any,
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Network error');
  });
});
