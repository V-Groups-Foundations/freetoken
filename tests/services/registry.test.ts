import { describe, it, expect } from 'vitest';
import { SERVICES, getService, toPublicService, deeplHost } from '@/services/registry';
import type { FetchFn } from '@/providers/client';

const ok = () => new Response('{}', { status: 200 });
const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as FetchFn;

describe('service registry', () => {
  it('lists the free services', () => {
    expect(SERVICES.map((s) => s.id).sort()).toEqual(
      ['deepl', 'elevenlabs', 'googletts', 'jina', 'ocrspace', 'tavily'],
    );
    for (const s of SERVICES) expect(s.keyUrl).toMatch(/^https:\/\//);
  });

  it('public view drops the validate function', () => {
    const pub = toPublicService(getService('tavily')!);
    expect(JSON.parse(JSON.stringify(pub))).toEqual(pub);
    expect('validate' in pub).toBe(false);
  });

  it('routes DeepL free keys to the free host', () => {
    expect(deeplHost('abc:fx')).toBe('api-free.deepl.com');
    expect(deeplHost('abc')).toBe('api.deepl.com');
  });

  it('accepts a working key', async () => {
    const r = await getService('tavily')!.validate('tvly-x', mock(ok));
    expect(r.ok).toBe(true);
  });

  it('rejects an auth failure', async () => {
    const r = await getService('tavily')!.validate('bad', mock(() => new Response('no', { status: 401 })));
    expect(r).toEqual({ ok: false, message: 'The service rejected this key.' });
  });

  it('saves-with-note on a transient (network) failure', async () => {
    const r = await getService('deepl')!.validate('x:fx', mock(() => { throw new Error('offline'); }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.note).toMatch(/unreachable/i);
  });

  it('saves-with-note on a 5xx', async () => {
    const r = await getService('tavily')!.validate('x', mock(() => new Response('err', { status: 503 })));
    expect(r.ok).toBe(true);
  });

  it('validates Jina (embed) via a Bearer embeddings call', async () => {
    const ok200 = await getService('jina')!.validate('jina_x', mock(() => new Response('{}', { status: 200 })));
    expect(ok200.ok).toBe(true);
    const bad = await getService('jina')!.validate('bad', mock(() => new Response('no', { status: 401 })));
    expect(bad).toEqual({ ok: false, message: 'The service rejected this key.' });
  });

  describe('ElevenLabs key validation', () => {
    const eleven = () => getService('elevenlabs')!;

    it('rejects a value that is not an sk_ secret key (the key ID mistake)', async () => {
      const r = await eleven().validate('abcd-1234-not-a-key', mock(ok));
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.message).toMatch(/sk_/);
    });

    it('accepts a working sk_ key', async () => {
      const r = await eleven().validate('sk_good', mock(() => new Response('{}', { status: 200 })));
      expect(r.ok).toBe(true);
    });

    it('rejects only when ElevenLabs says the key is invalid', async () => {
      const r = await eleven().validate('sk_bad', mock(() => new Response(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }), { status: 401 })));
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.message).toMatch(/rejected this key/);
    });

    it('saves-with-note when a scoped key lacks the models permission', async () => {
      const r = await eleven().validate('sk_scoped', mock(() => new Response(JSON.stringify({ detail: { status: 'missing_permissions', message: 'Missing permissions' } }), { status: 401 })));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.note).toMatch(/could not be fully verified/i);
    });

    it('saves-with-note when ElevenLabs is unreachable', async () => {
      const r = await eleven().validate('sk_x', mock(() => { throw new Error('offline'); }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.note).toMatch(/unreachable/i);
    });
  });

  it('rejects an OCR.space key only on an explicit key error', async () => {
    const good = await getService('ocrspace')!.validate('k', mock(() => new Response(JSON.stringify({ IsErroredOnProcessing: false, ParsedResults: [] }), { status: 200 })));
    expect(good.ok).toBe(true);
    const bad = await getService('ocrspace')!.validate('bad', mock(() => new Response(JSON.stringify({ IsErroredOnProcessing: true, ErrorMessage: 'Invalid API key' }), { status: 200 })));
    expect(bad).toEqual({ ok: false, message: 'OCR.space rejected this key.' });
  });
});
