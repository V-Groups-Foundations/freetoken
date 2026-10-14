// Chunking + embedding for retrieval. Embeddings go through the OpenAI-compatible
// /embeddings endpoint, so any source in EMBEDDING_PROVIDERS (chat provider or service)
// works by base URL + key alone — no ProviderDef needed.

import type { FetchFn } from '@/providers/client';

export interface Chunk {
  index: number;
  text: string;
}

/**
 * Split text into overlapping chunks on paragraph/sentence boundaries where possible.
 * Overlap keeps context across a boundary so a match near the edge stays coherent.
 */
export function chunkText(text: string, { size = 1200, overlap = 150 } = {}): Chunk[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [{ index: 0, text: clean }];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      // Prefer to break on a paragraph, then a sentence, then whitespace, within the last 40%.
      const window = clean.slice(start, end);
      const floor = Math.floor(size * 0.6);
      const br = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (br >= floor) end = start + br + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push({ index: index++, text: piece });
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export type EmbedResult =
  | { ok: true; vectors: number[][] }
  | { ok: false; status: number; message: string };

function embedErrorMessage(text: string, status: number): string {
  try {
    const j = JSON.parse(text);
    const err = Array.isArray(j) ? j[0]?.error : j.error;
    return (typeof err === 'string' ? err : err?.message) ?? j.message ?? `HTTP ${status}`;
  } catch {
    return text ? text.slice(0, 200) : `HTTP ${status}`;
  }
}

/** Embed one or more strings against any OpenAI-compatible `/embeddings` endpoint. Returns vectors in input order. */
export async function embedTexts(
  baseUrl: string,
  key: string,
  model: string,
  inputs: string[],
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<EmbedResult> {
  if (inputs.length === 0) return { ok: true, vectors: [] };

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: inputs }),
      signal: ctrl.signal,
    });
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the embedding provider.' };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, message: embedErrorMessage(text, res.status) };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, status: 502, message: 'The embedding provider returned an unreadable response.' };
  }
  const data = (json as { data?: { embedding?: number[] }[] })?.data;
  if (!Array.isArray(data) || data.length !== inputs.length) {
    return { ok: false, status: 502, message: 'The embedding provider returned an unexpected shape.' };
  }
  const vectors = data.map((d) => d.embedding ?? []);
  if (vectors.some((v) => v.length === 0)) {
    return { ok: false, status: 502, message: 'The embedding provider returned an empty vector.' };
  }
  return { ok: true, vectors };
}
