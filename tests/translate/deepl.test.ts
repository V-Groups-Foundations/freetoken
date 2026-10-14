import { describe, it, expect } from 'vitest';
import { resolveTarget, translateDeepL } from '@/translate/deepl';
import type { FetchFn } from '@/providers/client';

const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as FetchFn;

describe('resolveTarget', () => {
  it('maps English names to DeepL codes', () => {
    expect(resolveTarget('Spanish')).toBe('ES');
    expect(resolveTarget('japanese')).toBe('JA');
    expect(resolveTarget('Brazilian Portuguese')).toBe('PT-BR');
  });
  it('accepts raw codes', () => {
    expect(resolveTarget('de')).toBe('DE');
    expect(resolveTarget('PT-BR')).toBe('PT-BR');
  });
  it('returns null for unknown languages', () => {
    expect(resolveTarget('Klingon')).toBeNull();
    expect(resolveTarget('')).toBeNull();
  });
});

describe('translateDeepL', () => {
  it('posts to the free host for :fx keys and returns the translation', async () => {
    let seen = '';
    const fetchImpl = mock((url) => {
      seen = url;
      return new Response(JSON.stringify({ translations: [{ text: 'Hola' }] }), { status: 200 });
    });
    const out = await translateDeepL('Hello', 'ES', 'abc:fx', fetchImpl);
    expect(seen).toBe('https://api-free.deepl.com/v2/translate');
    expect(out).toBe('Hola');
  });

  it('throws on a non-200 response', async () => {
    await expect(translateDeepL('Hi', 'ES', 'k', mock(() => new Response('no', { status: 456 })))).rejects.toThrow();
  });
});
