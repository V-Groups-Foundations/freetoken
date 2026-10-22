// "Is this the network's fault?" Some networks — school, office and public Wi-Fi, some countries —
// block AI services (Google's Gemini API more often than most): the connection is refused or reset,
// the domain doesn't resolve, a firewall swaps in its own security certificate, or a web page comes
// back instead of the API's answer. Those are told apart from a bad key or a busy provider, so a key
// is never marked invalid because of the Wi-Fi, and the user is told what's actually going on.
import type { KV } from '@/lib/kv';

/** A connection that never got a proper answer from the API: what happened, in plain words. */
export function describeNetworkFailure(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } } | null;
  const code = String(err?.cause?.code ?? err?.code ?? '');
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return "its address couldn't be looked up (DNS) — the network may block it";
  if (/^ECONNREFUSED$/.test(code)) return 'the connection was refused';
  if (/^(ECONNRESET|UND_ERR_SOCKET|EPIPE)$/.test(code)) return 'the connection was cut off — the network may block it';
  if (/^(EHOSTUNREACH|ENETUNREACH|ENETDOWN)$/.test(code)) return "it couldn't be reached — check your internet connection";
  if (/^(UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT)$/.test(code)) return "the connection timed out — the network may block it";
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO/.test(code)) return "the network replaced the site's security certificate (a firewall or proxy is inspecting traffic)";
  return `the connection failed (${err?.cause?.message ?? err?.message ?? 'network error'})`;
}

/** An error response that's a web page rather than the API's JSON: a firewall, proxy or Wi-Fi login page. */
export const looksLikeWebPage = (contentType: string | null, body: string) =>
  /text\/html/i.test(contentType ?? '') || /^\s*(<!doctype html|<html|<head|<body)/i.test(body);

const PROVIDER_NAMES: Record<string, string> = { gemini: 'Gemini (Google)', groq: 'Groq', openrouter: 'OpenRouter', github: 'GitHub Models', cohere: 'Cohere', nvidia: 'NVIDIA', cloudflare: 'Cloudflare' };
export const providerName = (id: string) => PROVIDER_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

/** What to tell the user when a provider couldn't be reached from their network. */
export function unreachableHint(providers: string[]) {
  const names = providers.map(providerName);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `${list} couldn't be reached from this network. You might be on a restricted Wi-Fi — school, office and public networks often block AI services (Google's especially). Try another network, a phone hotspot or a VPN.`;
}

// ---------------------------------------------------------------- remembered per user, for the Connect page

const netKey = (userId: string, provider: string) => `net:${userId}:${provider}`;
export type NetStatus = { kind: 'network' | 'blocked'; message: string; at: number };

export async function noteUnreachable(kv: KV, userId: string, provider: string, s: NetStatus) {
  await kv.set(netKey(userId, provider), JSON.stringify(s), 30 * 60_000).catch(() => {});
}
/** It answered: forget that it was unreachable. */
export async function noteReachable(kv: KV, userId: string, provider: string) {
  if (await kv.get(netKey(userId, provider)).catch(() => null)) await kv.set(netKey(userId, provider), '', 1000).catch(() => {});
}
export async function netStatus(kv: KV, userId: string, provider: string): Promise<NetStatus | null> {
  const v = await kv.get(netKey(userId, provider)).catch(() => null);
  try { return v ? (JSON.parse(v) as NetStatus) : null; } catch { return null; }
}
