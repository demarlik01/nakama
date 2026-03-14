import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const WebFetchSchema = Type.Object({
  url: Type.String({ description: 'HTTP or HTTPS URL to fetch' }),
  maxChars: Type.Optional(
    Type.Number({
      minimum: 100,
      description: 'Maximum characters to return (default 50000)',
    }),
  ),
});

type WebFetchParams = Static<typeof WebFetchSchema>;

export function createWebFetchTool(): ToolDefinition<typeof WebFetchSchema> {
  return {
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Fetch a URL and extract readable content as markdown. Useful for reading articles, documentation, and web pages.',
    parameters: WebFetchSchema,
    async execute(toolCallId, params) {
      const { url, maxChars = 50_000 } = params as WebFetchParams;

      if (!url || url.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: url parameter is required' }],
          details: { error: true },
        };
      }

      try {
        new URL(url);
      } catch {
        return {
          content: [{ type: 'text', text: `Error: invalid URL: ${url}` }],
          details: { error: true },
        };
      }

      const startMs = Date.now();

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; Nakama/1.0; +https://github.com/nakama)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(30_000),
        });
      } catch (fetchError) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching URL: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
            },
          ],
          details: { error: true },
        };
      }

      if (!response.ok) {
        return {
          content: [
            { type: 'text', text: `Error: HTTP ${response.status} ${response.statusText}` },
          ],
          details: { error: true, status: response.status },
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const html = await response.text();

      let markdown: string;

      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        const { document } = parseHTML(html);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reader = new Readability(document as any);
        const article = reader.parse();

        if (article?.textContent) {
          markdown = htmlToMarkdown(article.content || '', article.title ?? undefined);
          if (markdown.trim().length === 0) {
            markdown = article.textContent;
          }
        } else {
          // Fallback: extract text from body
          const bodyText = (document as { body?: { textContent?: string | null } }).body?.textContent;
          markdown = bodyText?.trim() ?? html.slice(0, maxChars);
        }
      } else {
        // Non-HTML: return raw text
        markdown = html;
      }

      if (markdown.length > maxChars) {
        markdown = markdown.slice(0, maxChars) + '\n\n[truncated]';
      }

      const tookMs = Date.now() - startMs;
      const text = `# ${url}\n\n${markdown}`;

      return {
        content: [{ type: 'text', text }],
        details: { url, chars: markdown.length, tookMs },
      };
    },
  };
}

/**
 * Minimal HTML → markdown converter. No external library needed.
 */
function htmlToMarkdown(html: string, title?: string): string {
  let md = html;

  // Remove script, style, nav, footer tags and their content
  md = md.replace(/<(script|style|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Headers
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Bold & italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Images
  md = md.replace(/<img[^>]+alt="([^"]*)"[^>]+src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // List items
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

  // Paragraphs & line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n').trim();

  if (title) {
    md = `# ${title}\n\n${md}`;
  }

  return md;
}
