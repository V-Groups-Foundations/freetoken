import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { providerKeys } from '@/db/schema';
import { decrypt, encrypt } from '@/lib/vault';
import { callChat, type Credentials, type FetchFn } from '@/providers/client';
import type { ProviderDef } from '@/providers/registry';
import { unreachableHint } from '@/providers/network';

const byUserProvider = (userId: string, provider: string) =>
  and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider));

export async function saveKey(db: DB, userId: string, provider: string, key: string, extra: string | null, vaultKey?: Buffer) {
  const values = {
    encryptedKey: encrypt(key, vaultKey),
    encryptedExtra: extra ? encrypt(extra, vaultKey) : null,
    last4: key.slice(-4),
    status: 'valid',
  };
  await db.insert(providerKeys).values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [providerKeys.userId, providerKeys.provider], set: values });
}

export async function listKeys(db: DB, userId: string) {
  return db
    .select({
      provider: providerKeys.provider,
      last4: providerKeys.last4,
      status: providerKeys.status,
      excludedFromAuto: providerKeys.excludedFromAuto,
    })
    .from(providerKeys)
    .where(eq(providerKeys.userId, userId))
    .orderBy(providerKeys.provider);
}

export async function removeKey(db: DB, userId: string, provider: string) {
  await db.delete(providerKeys).where(byUserProvider(userId, provider));
}

export async function setExcluded(db: DB, userId: string, provider: string, excluded: boolean) {
  await db.update(providerKeys).set({ excludedFromAuto: excluded }).where(byUserProvider(userId, provider));
}

export async function markInvalid(db: DB, userId: string, provider: string) {
  await db.update(providerKeys).set({ status: 'invalid' }).where(byUserProvider(userId, provider));
}

export async function touchKey(db: DB, userId: string, provider: string) {
  await db.update(providerKeys).set({ lastUsedAt: new Date() }).where(byUserProvider(userId, provider));
}

/** Decrypted credentials for this user's valid keys. Never pass another user's id. */
export async function loadCredentials(db: DB, userId: string, vaultKey?: Buffer) {
  const rows = await db.select().from(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.status, 'valid')));
  const out = new Map<string, { creds: Credentials; excludedFromAuto: boolean }>();
  for (const r of rows) {
    out.set(r.provider, {
      creds: { key: decrypt(r.encryptedKey, vaultKey), extra: r.encryptedExtra ? decrypt(r.encryptedExtra, vaultKey) : null },
      excludedFromAuto: r.excludedFromAuto,
    });
  }
  return out;
}

export async function validateKey(
  def: ProviderDef,
  creds: Credentials,
  fetchImpl?: FetchFn,
): Promise<{ ok: true; note?: string } | { ok: false; message: string }> {
  const r = await callChat(
    def,
    creds,
    { model: def.validateModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
    { fetchImpl, timeoutMs: 30_000 },
  );
  if (r.ok) {
    await r.response.body?.cancel();
    return { ok: true };
  }
  if (r.error.kind === 'rate_limit') return { ok: true, note: 'Key works but is currently rate-limited.' };
  if (r.error.kind === 'auth') return { ok: false, message: 'The provider rejected this key.' };
  if (r.error.kind === 'forbidden') return { ok: true, note: `Key saved, but the provider refused the test model (${r.error.message}) — other models may still work.` };
  if (r.error.kind === 'not_found' || r.error.status === 404) return { ok: true, note: 'Key saved, but the test model is unavailable, so the key could not be fully verified.' };
  // The network can't reach the provider (restricted Wi-Fi, firewall): not the key's fault — save it,
  // and say why it couldn't be checked.
  if (r.error.kind === 'network' || r.error.kind === 'blocked') {
    return { ok: true, note: `Key saved, but it couldn't be checked: ${r.error.message}. ${unreachableHint([def.id])}` };
  }
  // A slow or hiccuping provider (timeout / 5xx) is not a bad key — save it rather than block it.
  if (r.error.kind === 'timeout' || r.error.kind === 'server') {
    return { ok: true, note: 'Key saved, but the provider was slow to respond, so it could not be fully verified. It should still work.' };
  }
  return { ok: false, message: `Could not verify the key: ${r.error.message}` };
}
