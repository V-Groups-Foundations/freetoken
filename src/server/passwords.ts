// Email + password accounts: anyone can sign up on a hosted FreeToken and keep their own keys, chats and
// diet log. Passwords are stored only as scrypt hashes (salted, memory-hard; Node's built-in crypto).
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { DB } from '@/db';
import { authTokens, loginFailures, users } from '@/db/schema';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const MIN_PASSWORD = 8;
export const normalizeEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [kind, salt, hash] = (stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, PARAMS);
  return timingSafeEqual(got, want);
}

/** Why a new password isn't acceptable, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return 'That password is too long.';
  return null;
}

// Wrong guesses per email: after MAX_TRIES in 15 minutes, that email is paused until the oldest of them
// is 15 minutes old. Kept in the database so every running copy of the app counts the same tries.
export const MAX_TRIES = 5;
const WINDOW = 15 * 60_000;

/** Tries left for this email, and (when none are left) the minutes until it can try again. */
export async function attempts(db: DB, emailIn: unknown, now = Date.now()): Promise<{ left: number; waitMinutes: number }> {
  const email = normalizeEmail(emailIn);
  const rows = await db.select({ at: loginFailures.failedAt }).from(loginFailures)
    .where(and(eq(loginFailures.email, email), gt(loginFailures.failedAt, new Date(now - WINDOW))))
    .orderBy(asc(loginFailures.failedAt));
  const left = Math.max(0, MAX_TRIES - rows.length);
  const waitMinutes = left > 0 ? 0 : Math.max(1, Math.ceil((rows[rows.length - MAX_TRIES].at.getTime() + WINDOW - now) / 60_000));
  return { left, waitMinutes };
}

export async function noteFailure(db: DB, email: string, now = Date.now()) {
  await db.delete(loginFailures).where(lte(loginFailures.failedAt, new Date(now - WINDOW))); // forget old tries
  await db.insert(loginFailures).values({ email, failedAt: new Date(now) });
}

export const clearFailures = (db: DB, email: string) => db.delete(loginFailures).where(eq(loginFailures.email, normalizeEmail(email)));

/** What a failed sign-up says (the page gets the code, so its URL can't be made to show other text). */
export const SIGNUP_ERRORS = {
  email: 'Enter a valid email address.',
  short: `Use a password of at least ${MIN_PASSWORD} characters.`,
  long: 'That password is too long.',
  taken: 'There is already an account with this email — sign in instead.',
  busy: 'Too many new accounts from this network just now — try again in 15 minutes.',
  unclaimed: 'This email already has an account without a password. Sign in the way you did before, then set a password under API → Password.',
} as const;
export type SignUpError = keyof typeof SIGNUP_ERRORS;
export type SignUpResult = { ok: true; userId: string } | { ok: false; error: SignUpError };

export async function signUp(db: DB, emailIn: unknown, password: string, nameIn?: unknown): Promise<SignUpResult> {
  const email = normalizeEmail(emailIn);
  if (!validEmail(email)) return { ok: false, error: 'email' };
  if (password.length < MIN_PASSWORD) return { ok: false, error: 'short' };
  if (password.length > 200) return { ok: false, error: 'long' };
  const [existing] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email));
  // never attach a password to an account someone else may own: claiming it needs that account's own sign-in
  if (existing) return { ok: false, error: existing.passwordHash ? 'taken' : 'unclaimed' };
  const name = String(nameIn ?? '').trim().slice(0, 80) || email.split('@')[0];
  const [created] = await db.insert(users).values({ email, name, passwordHash: await hashPassword(password) }).returning({ id: users.id });
  return { ok: true, userId: created.id };
}

/** The account for this email and password, or null. */
export async function checkPassword(db: DB, emailIn: unknown, passwordIn: unknown) {
  const email = normalizeEmail(emailIn);
  const password = String(passwordIn ?? '');
  if (!validEmail(email) || !password || (await attempts(db, email)).left === 0) return null;
  const [user] = await db.select().from(users).where(eq(users.email, email));
  // same work whether or not the account exists, so timing doesn't reveal which emails have accounts
  const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
  if (!user || !ok) { await noteFailure(db, email); return null; }
  await clearFailures(db, email);
  return user;
}

/**
 * Set or change the signed-in user's password. An existing one must be given first, unless this session
 * came from the owner's private sign-in link (`recovery`) — that link is how a forgotten password is reset.
 */
export async function setPassword(db: DB, userId: string, current: string, next: string, recovery = false): Promise<string | null> {
  const [user] = await db.select({ email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!user) return 'Sign in first.';
  if (user.passwordHash && !recovery && !(await verifyPassword(current, user.passwordHash))) return 'Your current password is wrong.';
  const problem = passwordProblem(next);
  if (problem) return problem;
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  if (user.email) await clearFailures(db, user.email); // a fresh password starts with all tries
  return null;
}

/* ---------------------------------------------------------------- sign-up limits */

/** New accounts per network (IP) per 15 minutes — stops scripted mass sign-ups. */
export const SIGNUPS_PER_WINDOW = 3;
const signupKey = (ip: string) => `signup:${ip}`;
export async function signupAllowed(db: DB, ip: string, now = Date.now()) {
  return (await attempts(db, signupKey(ip), now)).left > MAX_TRIES - SIGNUPS_PER_WINDOW;
}
export const noteSignup = (db: DB, ip: string, now = Date.now()) => noteFailure(db, signupKey(ip), now);

/* ---------------------------------------------------------------- one-time email links */

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const HOUR = 60 * 60_000;

/** A fresh link token (returned once, for the email); only its hash is stored. Older unused ones of that kind lapse. */
export async function issueToken(db: DB, userId: string, kind: 'reset' | 'verify', now = Date.now()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.update(authTokens).set({ usedAt: new Date(now) }).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  await db.insert(authTokens).values({ tokenHash: sha(token), userId, kind, expiresAt: new Date(now + (kind === 'reset' ? HOUR : 48 * HOUR)) });
  return token;
}

/** The user a link token belongs to, if it's that kind, unused and not expired — and marks it used. */
export async function redeemToken(db: DB, token: unknown, kind: 'reset' | 'verify', now = Date.now()): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 30) return null;
  const [row] = await db.select().from(authTokens).where(eq(authTokens.tokenHash, sha(token)));
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt.getTime() < now) return null;
  const used = await db.update(authTokens).set({ usedAt: new Date(now) }).where(and(eq(authTokens.tokenHash, row.tokenHash), isNull(authTokens.usedAt))).returning({ u: authTokens.userId });
  return used.length ? row.userId : null;
}

/** A still-valid token, without using it (to show the reset form only for a good link). */
export async function tokenValid(db: DB, token: unknown, kind: 'reset' | 'verify', now = Date.now()) {
  if (typeof token !== 'string' || token.length < 30) return false;
  const [row] = await db.select().from(authTokens).where(eq(authTokens.tokenHash, sha(token)));
  return Boolean(row && row.kind === kind && !row.usedAt && row.expiresAt.getTime() >= now);
}

/** Reset with a link: the token must be good; the new password must be acceptable. */
export async function resetPassword(db: DB, token: unknown, next: string): Promise<'ok' | 'bad-link' | 'weak'> {
  if (passwordProblem(next)) return 'weak';
  const userId = await redeemToken(db, token, 'reset');
  if (!userId) return 'bad-link';
  const problem = await setPassword(db, userId, '', next, true);
  return problem ? 'weak' : 'ok';
}

export async function markVerified(db: DB, token: unknown) {
  const userId = await redeemToken(db, token, 'verify');
  if (!userId) return false;
  await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, userId));
  return true;
}
