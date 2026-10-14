// Keyless URL reader via Jina Reader (r.jina.ai) — turns any web page into clean text.
// Verified keyless on 2026-10-14. If Jina later requires a key, this becomes a service.

import type { FetchFn } from '@/providers/client';

export interface ReadResult {
  title: string;
  url: string;
  text: string;
}

/** Ensure a user-typed target has an http(s) scheme; throws on anything else. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme); // throws on garbage
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs can be read.');
  }
  return parsed.toString();
}

export async function readUrl(target: string, fetchImpl: FetchFn = fetch): Promise<ReadResult> {
  const url = normalizeUrl(target);
  const res = await fetchImpl(`https://r.jina.ai/${url}`, {
    headers: { accept: 'application/json', 'x-return-format': 'markdown' },
  });
  if (!res.ok) throw new Error(`Reader returned ${res.status}`);
  const json = (await res.json()) as { data?: { title?: string; url?: string; content?: string } };
  const data = json.data ?? {};
  return {
    title: data.title?.trim() || url,
    url: data.url || url,
    text: data.content ?? '',
  };
}
