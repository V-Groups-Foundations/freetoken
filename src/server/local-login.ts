// Sign-in on your own computer, without Google or a password. `npm run dev` (scripts/start.mjs)
// writes a fresh random token to .data/local-login.token each time it starts and opens
// /welcome?t=<token>. Only someone who can read that file — i.e. you, on this machine — gets the link,
// the same idea as Jupyter's login token. FREETOKEN_LOCAL_LOGIN=off turns it off (e.g. on a server).
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { asc } from 'drizzle-orm';
import type { DB } from '@/db';
import { users } from '@/db/schema';

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
export async function localOwner(db: DB) {
  const [first] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (first) return first;
  const [created] = await db.insert(users).values({ name: 'You', email: 'you@this-computer.local', role: 'admin' }).returning();
  return created;
}
