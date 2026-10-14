// Web search via Tavily (BYO free key). Tavily is built for AI agents and returns both
// a synthesized answer and ranked source hits. Keyed — the key comes from the service vault.

import type { FetchFn } from '@/providers/client';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResult {
  answer: string | null;
  hits: SearchHit[];
}

export async function searchWeb(
  query: string,
  apiKey: string,
  opts: { maxResults?: number } = {},
  fetchImpl: FetchFn = fetch,
): Promise<SearchResult> {
  const res = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      max_results: Math.min(Math.max(opts.maxResults ?? 6, 1), 10),
      include_answer: true,
    }),
  });
  if (!res.ok) throw new Error(`Search returned ${res.status}`);
  const json = (await res.json()) as {
    answer?: string | null;
    results?: { title?: string; url: string; content?: string }[];
  };
  const hits: SearchHit[] = (json.results ?? []).map((r) => ({
    title: r.title?.trim() || r.url,
    url: r.url,
    snippet: r.content?.trim() ?? '',
  }));
  return { answer: json.answer?.trim() || null, hits };
}
