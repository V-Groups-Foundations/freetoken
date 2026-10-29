import type { KV } from '@/lib/kv';

/** 'headers': start until the upstream answered (callChat ok). 'first': start until a stream's first event. */
export type LatencyKind = 'headers' | 'first';

const KEEP = 20; // newest samples kept per model and measure
const MIN_SAMPLES = 5; // fewer than this and a p90 is noise: use the defaults
const TTL_MS = 7 * 86_400_000;
const FLOOR: Record<LatencyKind, number> = { headers: 10_000, first: 20_000 };

const key = (model: { provider: string; modelId: string }, kind: LatencyKind) => `lat:${model.provider}/${model.modelId}:${kind}`;

async function samples(kv: KV, k: string): Promise<number[]> {
  try {
    const v = JSON.parse((await kv.get(k)) ?? '[]');
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

/** Remember how long this model took (successes only: a timeout says nothing about how fast it normally is). */
export async function noteLatency(kv: KV, model: { provider: string; modelId: string }, kind: LatencyKind, ms: number): Promise<void> {
  const k = key(model, kind);
  const next = [...(await samples(kv, k)), Math.max(0, Math.round(ms))].slice(-KEEP);
  await kv.set(k, JSON.stringify(next), TTL_MS);
}

/** How long to wait on this model: 3 × its measured p90, never below the floor or above `fallback` (the old global
 * wait). One global 30s / 75s meant a model that normally answers in 2s held a stuck request for 30s before the
 * next model was tried; with too few samples we still use the global default. */
export async function timeoutFor(kv: KV, model: { provider: string; modelId: string }, kind: LatencyKind, fallback: number): Promise<number> {
  const s = await samples(kv, key(model, kind));
  if (s.length < MIN_SAMPLES) return fallback;
  const sorted = [...s].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
  return Math.min(fallback, Math.max(Math.min(FLOOR[kind], fallback), 3 * p90));
}
