import type { ProviderDef } from './registry';
import { describeNetworkFailure, looksLikeWebPage } from './network';

/** network = never got an answer (DNS, refused, reset, swapped certificate); blocked = a web page came back instead of the API */
export type ErrorKind = 'rate_limit' | 'auth' | 'server' | 'timeout' | 'bad_request' | 'not_found' | 'network' | 'blocked' | 'forbidden';

export interface ProviderError {
  kind: ErrorKind;
  status: number;
  message: string;
  retryAfterMs?: number;
  /** a rate limit that's this model's whole allowance for the day (Gemini's free tier), not a passing one */
  daily?: boolean;
  /** a request bigger than this model takes in one go (Groq: "Limit 7000, Requested 10727"): the cap */
  tokenLimit?: number;
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
    // Cloudflare: {"success":false,"errors":[{"code":7003,"message":"…"}]}
    return err?.message ?? j.message ?? (Array.isArray(j.errors) ? j.errors[0]?.message : undefined);
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

const MODEL_GONE = /\bmodel\b.{0,80}\b(unavailable|not available|does not exist|not found|decommissioned|no longer (available|supported))|\b(unknown|no such|invalid) model\b/i;

export function normalizeError(status: number, headers: Headers, bodyText: string): ProviderError {
  // a firewall / proxy / Wi-Fi login page (HTML, not the API's JSON) — the network's doing, not the key's
  if (status < 500 && looksLikeWebPage(headers.get('content-type'), bodyText)) {
    return { kind: 'blocked', status, message: `the network answered with its own web page instead of the API (HTTP ${status}) — a firewall, proxy or Wi-Fi login page` };
  }
  const message = extractMessage(bodyText) ?? `HTTP ${status}`;
  // Groq answers 413 when a request exceeds its per-minute token budget.
  if (status === 429 || status === 413) {
    // Gemini says which quota ran out (…PerDay… / …PerMinute…) and when to retry ("retryDelay": "39s")
    const geminiDelay = Number(bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)?.[1]);
    const tooLarge = /request too large|reduce your message size/i.test(message) ? Number(message.match(/Limit (\d+), Requested \d+/)?.[1]) : NaN;
    return {
      kind: 'rate_limit', status, message,
      retryAfterMs: parseRetryAfter(headers.get('retry-after')) ?? (Number.isFinite(geminiDelay) ? geminiDelay * 1000 : undefined),
      ...(/PerDay|per day|daily (limit|quota)|requests per day/i.test(bodyText) ? { daily: true } : {}),
      ...(tooLarge > 0 ? { tokenLimit: tooLarge } : {}),
    };
  }
  if (status === 401) return { kind: 'auth', status, message };
  // 403 isn't always the key: OpenRouter answers 403 for a prompt its moderation flagged, others for
  // "this key can't use this model". Only a 403 that's about the key disables the key.
  if (status === 403) {
    if (/flag|moderat|content polic|safety|violat/i.test(message)) return { kind: 'bad_request', status, message };
    if (/api[ _-]?key|invalid (key|token)|unauthori[sz]ed|authenticat|credential|key (is )?(revoked|disabled|expired)/i.test(message)) return { kind: 'auth', status, message };
    return { kind: 'forbidden', status, message };
  }
  // 404 = model retired/not on this key's plan; 410 = model reached end-of-life. Either way
  // skip just this model (and never let a dead test model block an otherwise-valid key).
  // Cloudflare: the saved Account ID isn't one ("Could not route to /client/v4/accounts/<it>/…") — every
  // model fails the same way until it's fixed, so it's the credentials, not one model
  if (status === 404 && /could not route to \/client\/v4\/accounts\/|object identifier is invalid/i.test(message)) {
    return { kind: 'auth', status, message: 'the Account ID saved with this key is wrong — paste the 32-character Account ID from the Cloudflare dashboard (Workers & Pages → Overview)' };
  }
  if (status === 404 || status === 410) return { kind: 'not_found', status, message };
  // some providers say the same with a 400 (LLM7: "Model 'X' is currently unavailable.")
  if (status === 400 && MODEL_GONE.test(message)) return { kind: 'not_found', status, message };
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
    // a 200 that isn't the API at all: a firewall answering "OK" for a blocked address (seen with GitHub
    // Models on an office network). Streamed, it would go to the client as if it were the model's reply.
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && /^text\/(plain|html)/i.test(type)) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: { kind: 'blocked', status: res.status, message: `the network answered instead of the provider (HTTP ${res.status}, ${type.split(';')[0]}: "${text.trim().slice(0, 40)}") — a firewall or proxy is blocking it` } };
    }
    if (res.ok) return { ok: true, response: res };
    const text = await res.text().catch(() => '');
    return { ok: false, error: normalizeError(res.status, res.headers, text) };
  } catch (e) {
    // our own time limit → timeout; anything else never got an answer → the network
    if (ctrl.signal.aborted) return { ok: false, error: { kind: 'timeout', status: 0, message: 'no answer in time' } };
    return { ok: false, error: { kind: 'network', status: 0, message: describeNetworkFailure(e) } };
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
    // our own time limit → timeout; anything else never got an answer → the network
    if (ctrl.signal.aborted) return { ok: false, error: { kind: 'timeout', status: 0, message: 'no answer in time' } };
    return { ok: false, error: { kind: 'network', status: 0, message: describeNetworkFailure(e) } };
  } finally {
    clearTimeout(timer);
  }
}
