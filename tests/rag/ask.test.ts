import { describe, it, expect } from 'vitest';
import { searchDocuments } from '@/rag/ask';
import type { LoadedChunk } from '@/rag/service';

// a fake embedding provider per base URL: Gemini says [1, 0, …] (3 numbers), Jina says [0, 1] (2 numbers)
const fetchImpl = (async (url: string) => {
  const vec = String(url).includes('jina') ? [0, 1] : [1, 0, 0];
  return Response.json({ data: [{ embedding: vec }] });
}) as unknown as typeof fetch;

const chunk = (name: string, provider: string, model: string, embedding: number[]): LoadedChunk =>
  ({ documentId: name, documentName: name, content: `about ${name}`, embedding, embedProvider: provider, embedModel: model });

describe('searching documents indexed with different embedding models', () => {
  const creds = new Map([['gemini', { creds: { key: 'g' } }], ['jina', { creds: { key: 'j' } }]]);
  it('searches each document with its own model, so a Jina-indexed one is still found with Gemini connected', async () => {
    const chunks = [chunk('jina-doc', 'jina', 'jina-embeddings-v3', [0, 1]), chunk('gemini-doc', 'gemini', 'gemini-embedding-001', [1, 0, 0])];
    const r = await searchDocuments('q', chunks, creds, 5, fetchImpl);
    expect(r.hits.map((h) => h.item.documentName).sort()).toEqual(['gemini-doc', 'jina-doc']);
    expect(r.hits.every((h) => h.score > 0.99)).toBe(true);
    expect(r.unsearchable).toEqual([]);
  });
  it('names documents indexed with a retired model or a disconnected provider instead of silently missing them', async () => {
    const chunks = [chunk('old-gemini', 'gemini', 'text-embedding-004', [1, 0, 0]), chunk('jina-doc', 'jina', 'jina-embeddings-v3', [0, 1])];
    const r = await searchDocuments('q', chunks, new Map([['gemini', { creds: { key: 'g' } }]]), 5, fetchImpl);
    expect(r.unsearchable.sort()).toEqual(['jina-doc', 'old-gemini']);
    expect(r.hits).toEqual([]);
  });
});
