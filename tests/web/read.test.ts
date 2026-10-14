import { describe, it, expect } from 'vitest';
import { normalizeUrl, readUrl } from '@/web/read';
import type { FetchFn } from '@/providers/client';

const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as FetchFn;

describe('normalizeUrl', () => {
  it('adds a scheme when missing', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
  });
  it('keeps an existing scheme', () => {
    expect(normalizeUrl('http://example.com/a')).toBe('http://example.com/a');
  });
  it('rejects non-http protocols', () => {
    expect(() => normalizeUrl('ftp://example.com')).toThrow();
  });
});

describe('readUrl', () => {
  it('parses the Jina reader JSON envelope', async () => {
    let seen = '';
    const fetchImpl = mock((url) => {
      seen = url;
      return new Response(JSON.stringify({ data: { title: 'Hi', url: 'https://x.com/', content: '# Hi\nbody' } }), { status: 200 });
    });
    const r = await readUrl('x.com', fetchImpl);
    expect(seen).toBe('https://r.jina.ai/https://x.com/');
    expect(r).toEqual({ title: 'Hi', url: 'https://x.com/', text: '# Hi\nbody' });
  });

  it('throws on a non-200 reader response', async () => {
    await expect(readUrl('x.com', mock(() => new Response('no', { status: 402 })))).rejects.toThrow();
  });
});
