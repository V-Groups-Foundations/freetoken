import { sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { providerLimits } from '@/db/schema';

export interface RateLimits {
  limitRequests: number | null;
  remainingRequests: number | null;
  requestsResetAt: Date | null;
  limitTokens: number | null;
  remainingTokens: number | null;
  tokensResetAt: Date | null;
}

/** Parse a Go-style duration ("2m59.56s", "7.66s", "1h2m3s") or bare seconds ("12") into ms. */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const re = /(\d+(?:\.\d+)?)(h|m|s|ms)/g;
  let ms = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) {
    matched = true;
    const n = Number(m[1]);
    ms += m[2] === 'h' ? n * 3_600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 'ms' ? n : n * 1000;
  }
  return matched ? Math.round(ms) : null;
}

const int = (v: string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Read OpenAI/Groq-style x-ratelimit-* headers. Returns null when none are present. */
export function parseRateHeaders(headers: Headers, now = Date.now()): RateLimits | null {
  const lr = int(headers.get('x-ratelimit-limit-requests'));
  const rr = int(headers.get('x-ratelimit-remaining-requests'));
  const lt = int(headers.get('x-ratelimit-limit-tokens'));
  const rt = int(headers.get('x-ratelimit-remaining-tokens'));
  if (lr == null && rr == null && lt == null && rt == null) return null;
  const resetReq = parseDuration(headers.get('x-ratelimit-reset-requests'));
  const resetTok = parseDuration(headers.get('x-ratelimit-reset-tokens'));
  return {
    limitRequests: lr,
    remainingRequests: rr,
    requestsResetAt: resetReq == null ? null : new Date(now + resetReq),
    limitTokens: lt,
    remainingTokens: rt,
    tokensResetAt: resetTok == null ? null : new Date(now + resetTok),
  };
}

export async function saveLimits(db: DB, userId: string, provider: string, modelId: string, l: RateLimits) {
  const row = { userId, provider, modelId, ...l, updatedAt: new Date() };
  await db.insert(providerLimits).values(row).onConflictDoUpdate({
    target: [providerLimits.userId, providerLimits.provider, providerLimits.modelId],
    set: { ...l, updatedAt: sql`now()` },
  });
}
