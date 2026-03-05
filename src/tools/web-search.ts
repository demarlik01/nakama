import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

const WebSearchSchema = Type.Object({
  query: Type.String({ description: 'Search query string' }),
  count: Type.Optional(
    Type.Number({ minimum: 1, maximum: 10, description: 'Number of results (1-10, default 5)' }),
  ),
  country: Type.Optional(
    Type.String({ description: '2-letter country code (e.g., "US", "KR")' }),
  ),
  freshness: Type.Optional(
    Type.String({
      description:
        'Filter by discovery time: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year), or "YYYY-MM-DDtoYYYY-MM-DD"',
    }),
  ),
});

type WebSearchParams = Static<typeof WebSearchSchema>;

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchToolOptions {
  braveApiKey: string;
}

export function createWebSearchTool(
  options: WebSearchToolOptions,
): ToolDefinition<typeof WebSearchSchema> {
  const { braveApiKey } = options;

  return {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web using Brave Search API. Returns titles, URLs, and descriptions for research.',
    parameters: WebSearchSchema,
    async execute(toolCallId, params) {
      const { query, count = 5, country, freshness } = params as WebSearchParams;

      if (!query || query.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: query parameter is required' }],
          details: { error: true },
        };
      }

      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(Math.max(count, 1), 10)));
      if (country) url.searchParams.set('country', country);
      if (freshness) url.searchParams.set('freshness', freshness);

      const startMs = Date.now();

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': braveApiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [
            {
              type: 'text',
              text: `Web search failed (${response.status}): ${errorText.slice(0, 200)}`,
            },
          ],
          details: { error: true, status: response.status },
        };
      }

      const data = (await response.json()) as {
        web?: {
          results?: Array<{
            title?: string;
            url?: string;
            description?: string;
          }>;
        };
      };

      const results: WebSearchResult[] = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        description: r.description ?? '',
      }));

      const tookMs = Date.now() - startMs;

      const payload = {
        query,
        count: results.length,
        tookMs,
        results,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  };
}
