import { describe, it, expect } from 'vitest';
import { searchWeb } from '@/web/search';
import type { FetchFn } from '@/providers/client';

const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as FetchFn;

describe('searchWeb', () => {
  it('maps Tavily results and the synthesized answer', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = mock((_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        answer: 'The answer.',
        results: [{ title: 'A', url: 'https://a.com', content: 'snippet a' }, { url: 'https://b.com' }],
      }), { status: 200 });
    });
    const r = await searchWeb('q', 'tvly-x', { maxResults: 3 }, fetchImpl);
    expect(body.query).toBe('q');
    expect(body.max_results).toBe(3);
    expect(body.include_answer).toBe(true);
    expect(r.answer).toBe('The answer.');
    expect(r.hits).toEqual([
      { title: 'A', url: 'https://a.com', snippet: 'snippet a' },
      { title: 'https://b.com', url: 'https://b.com', snippet: '' },
    ]);
  });

  it('clamps maxResults into 1..10', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = mock((_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    await searchWeb('q', 'k', { maxResults: 99 }, fetchImpl);
    expect(body.max_results).toBe(10);
  });

  it('throws on a non-200 response', async () => {
    await expect(searchWeb('q', 'k', {}, mock(() => new Response('no', { status: 432 })))).rejects.toThrow();
  });
});
