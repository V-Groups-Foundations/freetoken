import { createHash, randomBytes } from 'node:crypto';
import { saveKey } from '@/keys/service';
import type { Deps } from './deps';

const b64url = (buf: Buffer) => buf.toString('base64url');

export interface Pkce {
  verifier: string;
  challenge: string;
}

export async function makePkce(): Promise<Pkce> {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(callbackUrl: string, challenge: string, state: string): string {
  const u = new URL('https://openrouter.ai/auth');
  u.searchParams.set('callback_url', callbackUrl);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function handleOpenRouterCallback(
  userId: string,
  input: { code: string; verifier: string },
  deps: Deps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: input.code, code_verifier: input.verifier, code_challenge_method: 'S256' }),
    });
    if (!res.ok) return { ok: false, message: `OpenRouter rejected the authorization (HTTP ${res.status}).` };
    const key = (await res.json())?.key;
    if (typeof key !== 'string' || !key) return { ok: false, message: 'OpenRouter did not return a key.' };
    await saveKey(deps.db, userId, 'openrouter', key, null, deps.vaultKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not reach OpenRouter.' };
  }
}
