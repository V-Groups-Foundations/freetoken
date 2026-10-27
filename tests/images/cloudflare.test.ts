import { describe, it, expect } from 'vitest';
import { generateImageCloudflare } from '@/images/cloudflare';
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
