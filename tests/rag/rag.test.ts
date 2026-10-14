import { describe, it, expect } from 'vitest';
import { chunkText, embedTexts } from '@/rag/embed';
import { cosineSimilarity, topK } from '@/rag/search';
import { fakeFetch } from '../helpers/fake-fetch';

const GEMINI_EMBED = 'https://generativelanguage.googleapis.com/v1beta/openai';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkText('hello world')).toEqual([{ index: 0, text: 'hello world' }]);
  });
  it('returns nothing for blank text', () => {
    expect(chunkText('   \n  ')).toEqual([]);
  });
  it('splits long text into overlapping chunks', () => {
    const para = 'Sentence one is here. '.repeat(120); // ~2640 chars
    const chunks = chunkText(para, { size: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 1000)).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i)); // contiguous indexes
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('is 0 for mismatched or empty vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('topK', () => {
  it('ranks items by similarity to the query', () => {
    const items = [
      { id: 'far', embedding: [0, 1] },
      { id: 'near', embedding: [1, 0.1] },
      { id: 'mid', embedding: [1, 1] },
    ];
    const ranked = topK([1, 0], items, 2);
    expect(ranked.map((r) => r.item.id)).toEqual(['near', 'mid']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe('embedTexts', () => {
  const embResponse = (vs: number[][]) => Response.json({ data: vs.map((embedding) => ({ embedding })) });

  it('posts to /embeddings and returns vectors in order', async () => {
    const f = fakeFetch(() => embResponse([[1, 2], [3, 4]]));
    const r = await embedTexts(GEMINI_EMBED, 'k', 'text-embedding-004', ['a', 'b'], { fetchImpl: f.fn });
    expect(r).toEqual({ ok: true, vectors: [[1, 2], [3, 4]] });
    expect(f.calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/embeddings');
    expect(f.calls[0].body).toMatchObject({ model: 'text-embedding-004', input: ['a', 'b'] });
  });

  it('returns ok with no vectors for empty input without calling out', async () => {
    const f = fakeFetch(() => embResponse([]));
    const r = await embedTexts(GEMINI_EMBED, 'k', 'm', [], { fetchImpl: f.fn });
    expect(r).toEqual({ ok: true, vectors: [] });
    expect(f.calls).toHaveLength(0);
  });

  it('fails when the shape does not match the inputs', async () => {
    const f = fakeFetch(() => embResponse([[1, 2]]));
    const r = await embedTexts(GEMINI_EMBED, 'k', 'm', ['a', 'b'], { fetchImpl: f.fn });
    expect(r).toMatchObject({ ok: false, status: 502 });
  });

  it('surfaces provider errors', async () => {
    const f = fakeFetch(() => Response.json({ error: { message: 'bad key' } }, { status: 401 }));
    const r = await embedTexts(GEMINI_EMBED, 'k', 'm', ['a'], { fetchImpl: f.fn });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
});
