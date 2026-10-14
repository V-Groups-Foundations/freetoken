import { describe, it, expect } from 'vitest';
import { synthesizeTTS, TTS_SERVICES } from '@/tts/synthesize';
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
