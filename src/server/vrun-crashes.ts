import { createHash } from 'node:crypto';
import { desc, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { vrunCrashes } from '@/db/schema';

/**
 * Nothing personal in a crash report: V-Run removes it on the computer, and it's removed again here in case
 * an older or modified app didn't — home folders and user names in paths, emails, keys and tokens, URL
 * query strings, IP addresses, long hex/base64 runs.
 */
export function scrub(text: string): string {
  return text
    .replace(/[A-Za-z]:\\Users\\[^\\\s'"]+/gi, '~')
    .replace(/\/(Users|home)\/[^/\s'"]+/g, '~')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\b(ft|sk|re|pk|rk|ghp|gho|xox[bap])[_-][A-Za-z0-9_-]{8,}/g, '<key>')
    .replace(/\b(Bearer|token|key|secret|password)([=:\s]+)\S+/gi, '$1$2<hidden>')
    .replace(/(https?:\/\/[^\s?'"]+)\?[^\s'"]*/g, '$1?…')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b[A-Fa-f0-9]{32,}\b|[A-Za-z0-9+/]{40,}={0,2}/g, '<long>');
}

export type CrashReport = { version: string; os: string; kind: string; message: string; stack?: string };

/** Records one report: the same crash (version, kind, message, top of stack) again only counts up. */
export async function recordCrash(db: DB, r: CrashReport) {
  const message = scrub(r.message).slice(0, 1000);
  const stack = r.stack ? scrub(r.stack).split('\n').slice(0, 25).join('\n').slice(0, 6000) : null;
  const top = (stack ?? '').split('\n').filter((l) => /^\s*at /.test(l)).slice(0, 3).join('|');
  const signature = createHash('sha256').update([r.version, r.kind, message.replace(/\d+/g, 'N'), top.replace(/:\d+:\d+/g, '')].join('\n')).digest('hex');
  await db.insert(vrunCrashes).values({ signature, version: r.version.slice(0, 40), os: r.os.slice(0, 80), kind: r.kind.slice(0, 40), message, stack })
    .onConflictDoUpdate({ target: vrunCrashes.signature, set: { count: sql`${vrunCrashes.count} + 1`, lastSeen: sql`now()` } });
}

export const listCrashes = (db: DB, limit = 100) => db.select().from(vrunCrashes).orderBy(desc(vrunCrashes.lastSeen)).limit(limit);

/** Who may see the reports: the emails in VRUN_CRASH_VIEWERS (comma-separated). Nobody when it isn't set. */
export function canViewCrashes(email: string | null | undefined, env = process.env.VRUN_CRASH_VIEWERS) {
  if (!email || !env) return false;
  return env.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
