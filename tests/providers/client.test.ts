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
    expect(normalizeError(403, h(), '').kind).toBe('auth');
    expect(normalizeError(503, h(), '').kind).toBe('server');
    expect(normalizeError(404, h(), '').kind).toBe('server');
    expect(normalizeError(400, h(), '{"error":"bad"}')).toMatchObject({ kind: 'bad_request', message: 'bad' });
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
  it('uses the Cloudflare account id', async () => {
    const f = fakeFetch(() => okJson());
    await callChat(getProvider('cloudflare')!, { key: 't', extra: 'acc' }, {}, { fetchImpl: f.fn });
    expect(f.calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions');
  });
  it('returns normalized errors and treats network failures as timeout', async () => {
    const r1 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, {
      fetchImpl: fakeFetch(() => new Response('nope', { status: 401 })).fn,
    });
    expect(r1).toMatchObject({ ok: false, error: { kind: 'auth' } });
    const r2 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, {
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
    });
    expect(r2).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });
});
