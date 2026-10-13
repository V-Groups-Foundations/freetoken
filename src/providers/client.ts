import type { ProviderDef } from './registry';

export type ErrorKind = 'rate_limit' | 'auth' | 'server' | 'timeout' | 'bad_request';

export interface ProviderError {
  kind: ErrorKind;
  status: number;
  message: string;
  retryAfterMs?: number;
}

export interface Credentials {
  key: string;
  extra: string | null;
}

export type FetchFn = typeof fetch;

export type CallResult = { ok: true; response: Response } | { ok: false; error: ProviderError };

function extractMessage(text: string): string | undefined {
  try {
    const j = JSON.parse(text);
    const err = Array.isArray(j) ? j[0]?.error : j.error;
    if (typeof err === 'string') return err;
    return err?.message ?? j.message;
  } catch {
    return text ? text.slice(0, 200) : undefined;
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function normalizeError(status: number, headers: Headers, bodyText: string): ProviderError {
  const message = extractMessage(bodyText) ?? `HTTP ${status}`;
  // Groq answers 413 when a request exceeds its per-minute token budget.
  if (status === 429 || status === 413) {
    return { kind: 'rate_limit', status, message, retryAfterMs: parseRetryAfter(headers.get('retry-after')) };
  }
  if (status === 401 || status === 403) return { kind: 'auth', status, message };
  // 404 usually means the model was retired by the provider: try another candidate.
  if (status >= 500 || status === 404) return { kind: 'server', status, message };
  return { kind: 'bad_request', status, message };
}

export async function callChat(
  def: ProviderDef,
  creds: Credentials,
  body: Record<string, unknown>,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<CallResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  // Timeout covers time-to-headers only; cleared before the body streams.
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetchImpl(`${def.baseUrl(creds.extra)}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, response: res };
    const text = await res.text().catch(() => '');
    return { ok: false, error: normalizeError(res.status, res.headers, text) };
  } catch (e) {
    return { ok: false, error: { kind: 'timeout', status: 0, message: e instanceof Error ? e.message : 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}
