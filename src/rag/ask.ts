// Searching the user's documents for a question. Each document is searched with the embedding model
// that indexed it — vectors from different models can't be compared (a Jina-indexed document became
// unfindable once Gemini was connected) — and documents indexed with a model that's no longer
// available, or a provider that's no longer connected, are reported instead of silently missed.
import type { FetchFn } from '@/providers/client';
import { EMBEDDING_PROVIDERS } from '@/router/modalities';
import { embedTexts } from './embed';
import { topK } from './search';
import type { LoadedChunk } from './service';

type Creds = Map<string, { creds: { key: string } }>;

export async function searchDocuments(question: string, chunks: LoadedChunk[], creds: Creds, k: number, fetchImpl?: FetchFn) {
  const groups = new Map<string, LoadedChunk[]>();
  for (const ch of chunks) {
    const key = `${ch.embedProvider}\u0000${ch.embedModel}`;
    const g = groups.get(key);
    if (g) g.push(ch); else groups.set(key, [ch]);
  }
  const unsearchable = new Set<string>();
  const scored: { item: LoadedChunk; score: number }[] = [];
  let error: { message: string; status: number } | null = null;
  for (const group of groups.values()) {
    const { embedProvider, embedModel } = group[0];
    const spec = EMBEDDING_PROVIDERS.find((p) => p.provider === embedProvider && p.model === embedModel);
    const c = creds.get(embedProvider)?.creds;
    if (!spec || !c) { for (const ch of group) unsearchable.add(ch.documentName); continue; }
    const q = await embedTexts(spec.baseUrl, c.key, spec.model, [question], { fetchImpl });
    if (!q.ok) { error = { message: q.message, status: q.status || 502 }; continue; }
    scored.push(...topK(q.vectors[0], group, k));
  }
  const hits = scored.sort((a, b) => b.score - a.score).slice(0, k);
  return { hits, unsearchable: [...unsearchable], error: scored.length ? null : error };
}

/** What to tell the user about documents that can't be searched any more. */
export function reindexNote(names: string[]) {
  if (!names.length) return '';
  const one = names.length === 1;
  return ` ${one ? 'One document' : `${names.length} documents`} (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}) can't be searched any more — ${one ? 'it was' : 'they were'} indexed with a model or provider that's no longer available. Upload ${one ? 'it' : 'them'} again to search ${one ? 'it' : 'them'}.`;
}
