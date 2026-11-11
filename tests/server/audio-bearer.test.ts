import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { createToken } from '@/server/tokens';
import type { DB } from '@/db';

// The audio routes run with no browser session (an app on a server, like V-Bot): an ft_ API token is how
// it says who it is — the same token /api/v1 accepts.
let db: DB;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => db }));
vi.mock('@/lib/session', () => ({ sessionUserId: async () => null, requireUserId: async () => { throw new Error('no session'); } }));
vi.mock('@/server/deps', () => ({ getDeps: () => ({ db, vaultKey: Buffer.alloc(32, 1), fetchImpl: fetch }) }));

describe('audio routes accept an ft_ API token', () => {
  let token: string;
  beforeEach(async () => {
    db = await createTestDb();
    token = await createToken(db, (await createUser(db, 'vbot@example.com')).id, 'V-Bot');
  });

  it('voices: a valid token gets past sign-in (to "no TTS service connected"); none, or a wrong one, is 401', async () => {
    const { GET } = await import('@/app/api/audio/voices/route');
    const ok = await GET(new Request('http://x/api/audio/voices', { headers: { authorization: `Bearer ${token}` } }));
    expect(ok.status).toBe(400);
    expect((await ok.json()).error.code).toBe('no_tts');
    expect((await GET(new Request('http://x/api/audio/voices'))).status).toBe(401);
    expect((await GET(new Request('http://x/api/audio/voices', { headers: { authorization: 'Bearer ft_wrong' } }))).status).toBe(401);
  });

  it('transcribe and tts: no token is 401, a valid token is not', async () => {
    const stt = await import('@/app/api/audio/transcribe/route');
    const tts = await import('@/app/api/audio/tts/route');
    const form = () => { const f = new FormData(); f.append('file', new Blob([new Uint8Array(10)], { type: 'audio/webm' }), 'a.webm'); return f; };
    expect((await stt.POST(new Request('http://x/api/audio/transcribe', { method: 'POST', body: form() }))).status).toBe(401);
    expect((await stt.POST(new Request('http://x/api/audio/transcribe', { method: 'POST', body: form(), headers: { authorization: `Bearer ${token}` } }))).status).not.toBe(401);
    const body = JSON.stringify({ text: 'hello' });
    expect((await tts.POST(new Request('http://x/api/audio/tts', { method: 'POST', body, headers: { 'content-type': 'application/json' } }))).status).toBe(401);
    expect((await tts.POST(new Request('http://x/api/audio/tts', { method: 'POST', body, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } }))).status).not.toBe(401);
  });
});
