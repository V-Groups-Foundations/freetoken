import { describe, it, expect } from 'vitest';
import { synthesizeTTS, listVoices, TTS_SERVICES } from '@/tts/synthesize';
import type { FetchFn } from '@/providers/client';

const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as FetchFn;

describe('synthesizeTTS', () => {
  it('prefers ElevenLabs over Google', () => {
    expect(TTS_SERVICES[0]).toBe('elevenlabs');
  });

  it('turns ElevenLabs audio bytes into an mp3 data URL', async () => {
    let seen = '';
    const fetchImpl = mock((url) => { seen = url; return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); });
    const r = await synthesizeTTS('elevenlabs', 'k', 'hello', fetchImpl);
    expect(seen).toContain('api.elevenlabs.io/v1/text-to-speech/');
    expect(r).toEqual({ ok: true, dataUrl: 'data:audio/mpeg;base64,AQID' });
  });

  it('uses the chosen ElevenLabs voice id in the URL', async () => {
    let seen = '';
    const fetchImpl = mock((url) => { seen = url; return new Response(new Uint8Array([1]), { status: 200 }); });
    await synthesizeTTS('elevenlabs', 'k', 'hi', fetchImpl, 'VOICE123');
    expect(seen).toContain('/v1/text-to-speech/VOICE123');
  });

  it('derives the Google languageCode from the chosen voice name', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = mock((_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ audioContent: 'AQID' }), { status: 200 });
    });
    await synthesizeTTS('googletts', 'k', 'hi', fetchImpl, 'en-GB-Neural2-A');
    expect(body.voice).toEqual({ languageCode: 'en-GB', name: 'en-GB-Neural2-A' });
  });

  it('turns Google audioContent into an mp3 data URL', async () => {
    const fetchImpl = mock(() => new Response(JSON.stringify({ audioContent: 'AQID' }), { status: 200 }));
    const r = await synthesizeTTS('googletts', 'k', 'hello', fetchImpl);
    expect(r).toEqual({ ok: true, dataUrl: 'data:audio/mpeg;base64,AQID' });
  });

  it('fails on an empty string and unknown service', async () => {
    expect(await synthesizeTTS('elevenlabs', 'k', '   ')).toMatchObject({ ok: false, status: 400 });
    expect(await synthesizeTTS('nope', 'k', 'hi', mock(() => new Response('', { status: 200 })))).toMatchObject({ ok: false });
  });

  it('surfaces a provider error status', async () => {
    const r = await synthesizeTTS('elevenlabs', 'k', 'hi', mock(() => new Response('no', { status: 401 })));
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
});

describe('listVoices', () => {
  it('maps the ElevenLabs voice library with a readable description', async () => {
    const payload = { voices: [{ voice_id: 'v1', name: 'Rachel', labels: { accent: 'american', gender: 'female', use_case: 'narration' } }] };
    const r = await listVoices('elevenlabs', 'k', mock(() => new Response(JSON.stringify(payload), { status: 200 })));
    expect(r).toEqual({ ok: true, voices: [{ id: 'v1', name: 'Rachel', description: 'american · female · narration' }] });
  });

  it('keeps only the higher-quality Google voices and strips the locale prefix', async () => {
    const payload = { voices: [
      { name: 'en-US-Neural2-C', ssmlGender: 'FEMALE' },
      { name: 'en-US-Standard-A', ssmlGender: 'MALE' },
    ] };
    const r = await listVoices('googletts', 'k', mock(() => new Response(JSON.stringify(payload), { status: 200 })));
    expect(r).toEqual({ ok: true, voices: [{ id: 'en-US-Neural2-C', name: 'Neural2-C', description: 'female' }] });
  });

  it('surfaces an error status from the provider', async () => {
    const r = await listVoices('elevenlabs', 'k', mock(() => new Response('no', { status: 401 })));
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
});
