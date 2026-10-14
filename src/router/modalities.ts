// Which connected provider can serve each non-chat modality, and with which model.
// Kept in code (like vision.ts) so adding a capability needs no schema change.
// Real, stable model IDs are used here (not the catalog's display names) because these
// are sent straight to the live provider APIs when the user connects a real key.

import type { ProviderId } from '@/providers/registry';

/**
 * Text embeddings via the OpenAI-compatible /embeddings endpoint. Order = preference.
 * `provider` is the vault key id (a chat provider like 'gemini' OR a service like 'jina');
 * each entry carries its own base URL so the embed path needs no ProviderDef lookup.
 */
export const EMBEDDING_PROVIDERS: { provider: string; model: string; baseUrl: string; dimensions: number }[] = [
  { provider: 'gemini', model: 'text-embedding-004', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', dimensions: 768 },
  { provider: 'jina', model: 'jina-embeddings-v3', baseUrl: 'https://api.jina.ai/v1', dimensions: 1024 },
];

/** Speech-to-text via the OpenAI-compatible /audio/transcriptions endpoint. Order = preference. */
export const STT_PROVIDERS: { provider: ProviderId; model: string }[] = [
  { provider: 'groq', model: 'whisper-large-v3' },
];

// Text-to-speech now uses the browser's built-in speechSynthesis (no provider needed).

/** First entry whose provider the user has connected, or null. */
export function pickModality<T extends { provider: string }>(
  options: T[],
  connected: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): T | null {
  const has = (p: string) => ('has' in connected ? connected.has(p) : false);
  return options.find((o) => has(o.provider)) ?? null;
}
