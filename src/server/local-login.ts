// Sign-in on your own computer, without Google or a password. `npm run dev` (scripts/start.mjs)
// writes a fresh random token to .data/local-login.token each time it starts and opens
// /welcome?t=<token>. Only someone who can read that file — i.e. you, on this machine — gets the link,
// the same idea as Jupyter's login token. FREETOKEN_LOCAL_LOGIN=off turns it off (e.g. on a server).
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { providerKeys, users } from '@/db/schema';

export const localLoginEnabled = () => (process.env.FREETOKEN_LOCAL_LOGIN ?? '').toLowerCase() !== 'off';
export const localLoginFile = (root = process.cwd()) => path.join(root, '.data', 'local-login.token');

/** True when `token` is the current local sign-in token (constant-time compare). */
export function localLoginMatches(token: unknown, file = localLoginFile()): boolean {
  if (!localLoginEnabled() || typeof token !== 'string' || token.length < 32) return false;
  let current: string;
  try { current = readFileSync(file, 'utf8').trim(); } catch { return false; }
  if (current.length < 32) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(token), h(current));
}

/** The person who owns this install: the first account (so an existing setup keeps its keys and chats). */
/** Where the owner, once known, is remembered (next to the sign-in token). */
export const localOwnerFile = (root = process.cwd()) => path.join(root, '.data', 'local-owner');

/**
 * Whose account "you, on this computer" is. Once found it's pinned in .data/local-owner, so nobody can
 * take the place over later (it used to be "whoever has the most keys", which another user on a shared
 * install could win by adding keys). Until it's pinned: the oldest account that has provider keys —
 * not just the oldest account, which signed people into an empty placeholder when they had made their
 * real account later — else the oldest account. Only an account with keys gets pinned.
 */
export async function localOwner(db: DB, file = localOwnerFile()) {
  let pinned = '';
  try { pinned = readFileSync(file, 'utf8').trim(); } catch { /* not pinned yet */ }
  if (pinned) {
    const [owner] = await db.select().from(users).where(eq(users.id, pinned));
    if (owner) return owner;
  }
  const [withKeys] = await db.select({ id: users.id }).from(users)
    .innerJoin(providerKeys, eq(providerKeys.userId, users.id))
    .groupBy(users.id, users.createdAt)
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (withKeys) {
    try { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${withKeys.id}\n`); } catch { /* read-only: just not pinned */ }
    const [owner] = await db.select().from(users).where(eq(users.id, withKeys.id));
    if (owner) return owner;
  }
  const [oldest] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (oldest) return oldest;
  const [created] = await db.insert(users).values({ name: 'You', email: 'you@this-computer.local', role: 'admin' }).returning();
  return created;
}
