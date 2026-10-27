import { describe, it, expect } from 'vitest';
import { generateImageCloudflare, editImageCloudflare, editSize, parseImageDataUrl } from '@/images/cloudflare';
import { fakeFetch } from '../helpers/fake-fetch';

const creds = { key: 'cf-token', accountId: 'a'.repeat(32) };

describe('generateImageCloudflare', () => {
  it('calls FLUX.1 schnell on the account and returns a data URL', async () => {
    const f = fakeFetch(() => Response.json({ success: true, result: { image: 'AQID' }, errors: [] }));
    const r = await generateImageCloudflare({ prompt: ' a red fox ' }, creds, { fetchImpl: f.fn });
    expect(r).toEqual({ ok: true, dataUrl: 'data:image/jpeg;base64,AQID' });
    expect(f.calls[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/run/@cf/black-forest-labs/flux-1-schnell`);
    expect(f.calls[0].auth).toBe('Bearer cf-token');
    expect(f.calls[0].body).toEqual({ prompt: 'a red fox', steps: 4 });
  });

  it('rejects an empty prompt or a missing Account ID without calling out', async () => {
    const f = fakeFetch(() => Response.json({}));
    expect(await generateImageCloudflare({ prompt: '  ' }, creds, { fetchImpl: f.fn })).toMatchObject({ ok: false, status: 400 });
    expect(await generateImageCloudflare({ prompt: 'p' }, { key: 'k', accountId: null }, { fetchImpl: f.fn })).toMatchObject({ ok: false, status: 400 });
    expect(f.calls).toHaveLength(0);
  });

  it('says when the daily free allowance is used up', async () => {
    const f = fakeFetch(() => Response.json(
      { success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] },
      { status: 429 },
    ));
    const r = await generateImageCloudflare({ prompt: 'p' }, creds, { fetchImpl: f.fn });
    expect(r).toMatchObject({ ok: false, status: 429 });
    if (!r.ok) expect(r.message).toMatch(/00:00 UTC/);
  });

  it('reports a rejected key', async () => {
    const f = fakeFetch(() => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 }));
    const r = await generateImageCloudflare({ prompt: 'p' }, creds, { fetchImpl: f.fn });
    expect(r).toMatchObject({ ok: false, status: 403 });
    if (!r.ok) expect(r.message).toMatch(/rejected your key/);
  });

  it('treats a success with no image as blocked', async () => {
    const f = fakeFetch(() => Response.json({ success: true, result: {} }));
    expect(await generateImageCloudflare({ prompt: 'p' }, creds, { fetchImpl: f.fn })).toMatchObject({ ok: false, status: 502 });
  });
});

describe('editImageCloudflare', () => {
  const pic = (b: number[]) => ({ bytes: new Uint8Array(b), type: 'image/jpeg' });
  // fakeFetch parses JSON bodies; edits are multipart, so capture the form itself
  const capture = (res: () => Response) => {
    const calls: { url: string; form: FormData; auth: string | null }[] = [];
    const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), form: init.body as FormData, auth: new Headers(init.headers).get('authorization') });
      return res();
    }) as typeof fetch;
    return { fn, calls };
  };

  it('sends the instruction and every picture, in order, to FLUX.2 klein at the photo shape', async () => {
    const f = capture(() => Response.json({ success: true, result: { image: 'AQID' } }));
    const r = await editImageCloudflare({ prompt: ' swap the faces ', images: [pic([1]), pic([2, 2])], width: 1536, height: 2048 }, creds, { fetchImpl: f.fn });
    expect(r).toEqual({ ok: true, dataUrl: 'data:image/jpeg;base64,AQID' });
    expect(f.calls[0].url).toMatch(/\/ai\/run\/@cf\/black-forest-labs\/flux-2-klein-4b$/);
    expect(f.calls[0].auth).toBe('Bearer cf-token');
    const form = f.calls[0].form;
    expect(form.get('prompt')).toBe('swap the faces');
    expect([form.get('width'), form.get('height')]).toEqual(['768', '1024']);
    expect((form.get('input_image_0') as Blob).size).toBe(1);
    expect((form.get('input_image_1') as Blob).size).toBe(2);
    expect(form.get('input_image_2')).toBeNull();
  });

  it('needs an instruction and 1–4 pictures before calling out', async () => {
    const f = capture(() => Response.json({}));
    expect(await editImageCloudflare({ prompt: ' ', images: [pic([1])] }, creds, { fetchImpl: f.fn })).toMatchObject({ ok: false, status: 400 });
    expect(await editImageCloudflare({ prompt: 'x', images: [] }, creds, { fetchImpl: f.fn })).toMatchObject({ ok: false, status: 400 });
    expect(await editImageCloudflare({ prompt: 'x', images: Array(5).fill(pic([1])) }, creds, { fetchImpl: f.fn })).toMatchObject({ ok: false, status: 400 });
    expect(f.calls).toHaveLength(0);
  });

  it('says when the daily allowance is used up', async () => {
    const f = capture(() => Response.json({ success: false, errors: [{ code: 4006, message: 'daily free allocation of 10,000 neurons' }] }, { status: 429 }));
    expect(await editImageCloudflare({ prompt: 'x', images: [pic([1])] }, creds, { fetchImpl: f.fn })).toMatchObject({ ok: false, status: 429 });
  });
});

describe('editSize', () => {
  it('keeps the shape, caps the long side at 1024 and rounds to 16', () => {
    expect(editSize(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(editSize(500, 333)).toEqual({ width: 496, height: 336 });
    expect(editSize()).toEqual({ width: 1024, height: 1024 });
  });
});

describe('parseImageDataUrl', () => {
  it('reads base64 image data URLs and refuses anything else', () => {
    expect(parseImageDataUrl('data:image/PNG;base64,AQID')).toEqual({ bytes: Buffer.from([1, 2, 3]), type: 'image/png' });
    expect(parseImageDataUrl('data:text/html;base64,AQID')).toBeNull();
    expect(parseImageDataUrl('https://example.com/a.jpg')).toBeNull();
    expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
  });
});
