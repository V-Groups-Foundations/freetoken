import type { ProviderDef } from './registry';

export type ErrorKind = 'rate_limit' | 'auth' | 'server' | 'timeout' | 'bad_request' | 'not_found';

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
  // 404 = model retired/not on this key's plan; 410 = model reached end-of-life. Either way
  // skip just this model (and never let a dead test model block an otherwise-valid key).
  if (status === 404 || status === 410) return { kind: 'not_found', status, message };
  if (status >= 500) return { kind: 'server', status, message };
  return { kind: 'bad_request', status, message };
}

/** POST a request to any OpenAI-compatible path on a provider, with shared timeout + error mapping. */
export async function postJson(
  def: ProviderDef,
  creds: Credentials,
  path: string,
  body: Record<string, unknown>,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<CallResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  // Timeout covers time-to-headers only; cleared before the body streams.
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetchImpl(`${def.baseUrl(creds.extra)}${path}`, {
      method: 'POST',
      // keyless providers (the built-in starter) get no Authorization header at all
      headers: { 'content-type': 'application/json', ...(creds.key ? { authorization: `Bearer ${creds.key}` } : {}) },
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

export function callChat(
  def: ProviderDef,
  creds: Credentials,
  body: Record<string, unknown>,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<CallResult> {
  return postJson(def, creds, '/chat/completions', body, opts);
}

/** POST an audio file to the OpenAI-compatible /audio/transcriptions endpoint (multipart form). */
export async function callTranscription(
  def: ProviderDef,
  creds: Credentials,
  input: { file: Blob; filename: string; model: string },
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<CallResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  try {
    const form = new FormData();
    form.append('model', input.model);
    form.append('file', input.file, input.filename);
    const res = await fetchImpl(`${def.baseUrl(creds.extra)}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.key}` }, // let fetch set the multipart boundary
      body: form,
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
