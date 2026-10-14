import { describe, it, expect } from 'vitest';
import { generateImage, buildUrl } from '@/images/generate';
import { fakeFetch } from '../helpers/fake-fetch';

const imageResponse = (bytes = [255, 216, 255]) =>
  new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } });

describe('buildUrl', () => {
  it('encodes the prompt and includes the flux model', () => {
    const url = buildUrl({ prompt: 'a red fox', seed: 42, width: 512, height: 512 });
    expect(url).toContain('https://image.pollinations.ai/prompt/a%20red%20fox');
    expect(url).toContain('model=flux');
    expect(url).toContain('seed=42');
    expect(url).toContain('width=512');
  });
  it('honors a known model and ignores an unknown one', () => {
    expect(buildUrl({ prompt: 'x', model: 'turbo' })).toContain('model=turbo');
    expect(buildUrl({ prompt: 'x', model: 'bogus' })).toContain('model=flux');
  });
});

describe('generateImage', () => {
  it('fetches a keyless image and returns a data URL', async () => {
    const f = fakeFetch(() => imageResponse([1, 2, 3]));
    const r = await generateImage({ prompt: 'a red fox' }, { fetchImpl: f.fn });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(f.calls[0].url).toContain('image.pollinations.ai');
  });

  it('rejects an empty prompt without calling out', async () => {
    const f = fakeFetch(() => imageResponse());
    const r = await generateImage({ prompt: '   ' }, { fetchImpl: f.fn });
    expect(r.ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it('surfaces an HTTP error from the image service', async () => {
    const f = fakeFetch(() => new Response('busy', { status: 503 }));
    const r = await generateImage({ prompt: 'p' }, { fetchImpl: f.fn });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it('rejects a non-image response', async () => {
    const f = fakeFetch(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await generateImage({ prompt: 'p' }, { fetchImpl: f.fn });
    expect(r).toMatchObject({ ok: false, status: 502 });
  });
});
