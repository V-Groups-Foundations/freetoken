import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import { fakeFetch } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { listKeys } from '@/keys/service';
import { makePkce, buildAuthUrl, handleOpenRouterCallback } from '@/server/oauth';

describe('PKCE', () => {
  it('derives an S256 challenge from the verifier', async () => {
    const { verifier, challenge } = await makePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
  it('builds the authorize URL with callback, challenge and state', () => {
    const url = new URL(buildAuthUrl('http://localhost:3000/api/connect/openrouter/callback', 'CHAL', 'STATE'));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe('http://localhost:3000/api/connect/openrouter/callback');
    expect(url.searchParams.get('code_challenge')).toBe('CHAL');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('STATE');
  });
});

describe('handleOpenRouterCallback', () => {
  let db: DB;
  let userId: string;
  beforeEach(async () => {
    db = await createTestDb();
    userId = (await createUser(db)).id;
  });
  const deps = (fetchImpl = fakeFetch(() => Response.json({ key: 'sk-or-v1-exchanged' })).fn) =>
    ({ db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY, fetchImpl });

  it('exchanges the code and saves the key', async () => {
    const d = deps();
    const r = await handleOpenRouterCallback(userId, { code: 'auth-code', verifier: 'ver' }, d as never);
    expect(r).toEqual({ ok: true });
    expect(await listKeys(db, userId)).toEqual([
      { provider: 'openrouter', last4: 'nged', status: 'valid', excludedFromAuto: false },
    ]);
  });

  it('sends the code and verifier to the exchange endpoint', async () => {
    const f = fakeFetch(() => Response.json({ key: 'sk-or-v1-abcd' }));
    await handleOpenRouterCallback(userId, { code: 'the-code', verifier: 'the-verifier' }, deps(f.fn) as never);
    expect(f.calls[0].url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(f.calls[0].body).toEqual({ code: 'the-code', code_verifier: 'the-verifier', code_challenge_method: 'S256' });
  });

  it('reports failure when OpenRouter returns no key', async () => {
    const r = await handleOpenRouterCallback(userId, { code: 'x', verifier: 'y' }, deps(fakeFetch(() => new Response('{}', { status: 400 })).fn) as never);
    expect(r.ok).toBe(false);
    expect(await listKeys(db, userId)).toEqual([]);
  });
});
