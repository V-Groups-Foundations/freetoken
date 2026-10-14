// Vector search in plain JS. For a personal BYOK app the corpus is small, so cosine
// similarity over in-memory vectors is plenty; swapping in pgvector later would only
// change this file and the store's query, not the callers.

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Top-k items by cosine similarity to the query vector, highest first. */
export function topK<T extends { embedding: number[] }>(
  query: number[],
  items: T[],
  k = 5,
): Scored<T>[] {
  return items
    .map((item) => ({ item, score: cosineSimilarity(query, item.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, Math.max(0, k));
}
