import { describe, it, expect } from 'vitest';
import { callChat, normalizeError } from '@/providers/client';
import { getProvider } from '@/providers/registry';
import { fakeFetch, okJson } from '../helpers/fake-fetch';

const h = (o: Record<string, string> = {}) => new Headers(o);

describe('normalizeError', () => {
  it('maps 429 with retry-after seconds', () => {
    expect(normalizeError(429, h({ 'retry-after': '12' }), '{"error":{"message":"slow down"}}'))
      .toEqual({ kind: 'rate_limit', status: 429, message: 'slow down', retryAfterMs: 12000 });
  });
  it('maps auth, server, 404 and bad request', () => {
    expect(normalizeError(401, h(), '').kind).toBe('auth');
    // a 403 only means a bad key when it says so; moderation is the request's fault; anything else: skip the model
    expect(normalizeError(403, h(), '{"error":{"message":"Invalid API key provided"}}').kind).toBe('auth');
    expect(normalizeError(403, h(), '{"error":{"message":"Input flagged by moderation"}}').kind).toBe('bad_request');
    expect(normalizeError(403, h(), '').kind).toBe('forbidden');
    expect(normalizeError(413, h(), '').kind).toBe('rate_limit');
    expect(normalizeError(503, h(), '').kind).toBe('server');
    expect(normalizeError(404, h(), '').kind).toBe('not_found');
    expect(normalizeError(410, h(), '').kind).toBe('not_found'); // EOL model

    expect(normalizeError(400, h(), '{"error":"bad"}')).toMatchObject({ kind: 'bad_request', message: 'bad' });
    // a 400 about the model itself (LLM7: "Model 'X' is currently unavailable"): skip just that model
    expect(normalizeError(400, h(), `{"error":{"message":"Model 'DeepSeek-V4-Flash-0731' is currently unavailable."}}`).kind).toBe('not_found');
    expect(normalizeError(400, h(), '{"error":{"message":"The model `foo` does not exist"}}').kind).toBe('not_found');
    expect(normalizeError(400, h(), '{"error":{"message":"Unknown model: foo"}}').kind).toBe('not_found');
    expect(normalizeError(400, h(), '{"error":{"message":"temperature must be at most 2"}}').kind).toBe('bad_request');
  });
  it('survives non-JSON (HTML) bodies', () => {
    const e = normalizeError(502, h(), '<html>Bad Gateway</html>');
    expect(e.kind).toBe('server');
    expect(e.message).toContain('Bad Gateway');
  });
  it('reads Gemini-style array errors', () => {
    expect(normalizeError(429, h(), '[{"error":{"message":"quota"}}]').message).toBe('quota');
  });
});

describe('callChat', () => {
  it('posts to the provider chat endpoint with a bearer key', async () => {
    const f = fakeFetch(() => okJson());
    const r = await callChat(getProvider('groq')!, { key: 'gsk_1', extra: null }, { model: 'm', messages: [] }, { fetchImpl: f.fn });
    expect(r.ok).toBe(true);
    expect(f.calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(f.calls[0].auth).toBe('Bearer gsk_1');
  });
  it('posts to the NVIDIA NIM OpenAI-compatible endpoint', async () => {
    const f = fakeFetch(() => okJson());
    await callChat(getProvider('nvidia')!, { key: 'nvapi-x', extra: null }, { model: 'm', messages: [] }, { fetchImpl: f.fn });
    expect(f.calls[0].url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(f.calls[0].auth).toBe('Bearer nvapi-x');
  });
  it('returns normalized errors; a dropped connection is the network, no answer in time is a timeout', async () => {
    const r1 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, {
      fetchImpl: fakeFetch(() => new Response('nope', { status: 401 })).fn,
    });
    expect(r1).toMatchObject({ ok: false, error: { kind: 'auth' } });
    const r2 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, {
      fetchImpl: (async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) }); }) as typeof fetch,
    });
    expect(r2).toMatchObject({ ok: false, error: { kind: 'network', message: expect.stringContaining('DNS') } });
    const r3 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, { fetchImpl: (async (_u: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as typeof fetch, timeoutMs: 50 });
    expect(r3).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    // a firewall's block page (HTML) is "blocked", not a rejected key
    const r4 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, {
      fetchImpl: fakeFetch(() => new Response('<html><body>Blocked by policy</body></html>', { status: 403, headers: { 'content-type': 'text/html' } })).fn,
    });
    expect(r4).toMatchObject({ ok: false, error: { kind: 'blocked' } });
  });
});
