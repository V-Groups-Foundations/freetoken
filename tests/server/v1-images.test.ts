import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { saveKey } from '@/keys/service';
import { createToken } from '@/server/tokens';
import { listImages } from '@/images/gallery';
import { handleImageGenerations } from '@/server/v1-images';

let db: DB;
let userId: string;
let token: string;
beforeEach(async () => {
  process.env.IMAGES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-v1img-'));
  db = await createTestDb();
  userId = (await createUser(db)).id;
  token = await createToken(db, userId, 'v-run');
});

/** Cloudflare answers with `cf`; Pollinations with a 3-byte JPEG. */
const fetcher = (cf: () => Response) => {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('api.cloudflare.com')) return cf();
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  return { fn, urls };
};
const call = (f: ReturnType<typeof fetcher>, body: unknown, auth = `Bearer ${token}`) =>
  handleImageGenerations(new Request('http://localhost/api/v1/images/generations', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body) }),
    { db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY, fetchImpl: f.fn });
const withCloudflare = () => saveKey(db, userId, 'cloudflare', 'cf-token', 'a'.repeat(32), TEST_VAULT_KEY);

describe('/v1/images/generations', () => {
  it('needs a FreeToken token and a prompt', async () => {
    const f = fetcher(() => Response.json({}));
    expect((await call(f, { prompt: 'x' }, 'Bearer ft_nope')).status).toBe(401);
    expect((await call(f, {})).status).toBe(400);
    expect(f.urls).toHaveLength(0);
  });

  it('uses Cloudflare FLUX when connected, OpenAI-shaped, and keeps it in the gallery', async () => {
    await withCloudflare();
    const f = fetcher(() => Response.json({ success: true, result: { image: 'AQID' } }));
    const res = await call(f, { prompt: 'an app icon of a fox', n: 2 });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data).toEqual([{ b64_json: 'AQID', revised_prompt: 'an app icon of a fox' }, { b64_json: 'AQID', revised_prompt: 'an app icon of a fox' }]);
    expect(f.urls.every((u) => u.includes('flux-1-schnell'))).toBe(true);
    expect((await listImages(db, userId)).map((i) => [i.kind, i.engine])).toEqual([['api', 'cloudflare'], ['api', 'cloudflare']]);
  });

  it('falls back to Pollinations when the Cloudflare day is used up, or with no Cloudflare key', async () => {
    await withCloudflare();
    const used = fetcher(() => Response.json({ success: false, errors: [{ code: 4006, message: 'daily free allocation' }] }, { status: 429 }));
    const j = await (await call(used, { prompt: 'p', response_format: 'url' })).json();
    expect(j.data[0].url).toBe('data:image/jpeg;base64,/9j/');
    expect(used.urls[1]).toContain('pollinations');
  });

  it("doesn't retry a result Cloudflare's safety filter blocked elsewhere", async () => {
    await withCloudflare();
    const f = fetcher(() => Response.json({ success: false, errors: [{ code: 3030, message: 'AiError: Your output has been flagged.' }] }, { status: 400 }));
    const res = await call(f, { prompt: 'p' });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('content_filtered');
    expect(f.urls).toHaveLength(1);
  });

  it('uses Pollinations without a Cloudflare key', async () => {
    const f = fetcher(() => Response.json({}));
    expect((await call(f, { prompt: 'p', size: '512x512' })).status).toBe(200);
    expect(f.urls[0]).toMatch(/pollinations.*width=512/);
  });
});
