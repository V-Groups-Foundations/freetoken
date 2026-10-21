import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { modelFeedback, usageEvents } from '@/db/schema';
import { learnedAdjustment } from '@/router/quality';
import { usageKey } from '@/router/select';

export interface UsageEvent {
  userId: string;
  provider: string;
  modelId: string;
  source: 'chat' | 'api';
  promptTokens: number;
  completionTokens: number;
  status: 'ok' | 'rate_limited' | 'error';
  latencyMs: number;
  /** token counts are a guess because the provider didn't report them */
  estimated?: boolean;
  task?: string;
}

export async function recordUsage(db: DB, e: UsageEvent) {
  await db.insert(usageEvents).values(e);
}

/** Start of the current usage day (00:00 UTC). */
export const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
/** Start of the current calendar month (UTC). */
export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export function usageToday(db: DB, userId: string, now = new Date()) {
  return usageSince(db, userId, dayStart(now));
}

/** Failed or rate-limited attempts per provider/model since `start` (auto routing steps around them). */
export async function recentFailures(db: DB, userId: string, start: Date) {
  const rows = await db
    .select({ provider: usageEvents.provider, modelId: usageEvents.modelId, n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), sql`${usageEvents.status} <> 'ok'`, gte(usageEvents.createdAt, start)))
    .groupBy(usageEvents.provider, usageEvents.modelId);
  return new Map(rows.map((r) => [usageKey(r.provider, r.modelId), r.n]));
}

/**
 * What auto routing has learned about each model for one kind of task since `start`: how often its
 * requests succeed (rate limits don't count — that's quota, not quality) and what clients reported
 * about its answers. A score adjustment per provider/model; models with little history get ~0.
 */
export async function learnedScores(db: DB, userId: string, task: string, start: Date) {
  const [runs, votes] = await Promise.all([
    db.select({
      provider: usageEvents.provider, modelId: usageEvents.modelId,
      ok: sql<number>`count(*) filter (where ${usageEvents.status} = 'ok')::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'error')::int`,
    }).from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), eq(usageEvents.task, task), gte(usageEvents.createdAt, start)))
      .groupBy(usageEvents.provider, usageEvents.modelId),
    db.select({
      provider: modelFeedback.provider, modelId: modelFeedback.modelId,
      good: sql<number>`count(*) filter (where ${modelFeedback.good})::int`,
      bad: sql<number>`count(*) filter (where not ${modelFeedback.good})::int`,
    }).from(modelFeedback)
      .where(and(eq(modelFeedback.userId, userId), eq(modelFeedback.task, task), gte(modelFeedback.createdAt, start)))
      .groupBy(modelFeedback.provider, modelFeedback.modelId),
  ]);
  const stats = new Map<string, { ok: number; errors: number; good: number; bad: number }>();
  const at = (p: string, m: string) => { const k = usageKey(p, m); let v = stats.get(k); if (!v) stats.set(k, (v = { ok: 0, errors: 0, good: 0, bad: 0 })); return v; };
  for (const r of runs) Object.assign(at(r.provider, r.modelId), { ok: r.ok, errors: r.errors });
  for (const r of votes) Object.assign(at(r.provider, r.modelId), { good: r.good, bad: r.bad });
  return new Map([...stats].map(([k, v]) => [k, learnedAdjustment(v)]));
}

export async function recordFeedback(db: DB, f: { userId: string; provider: string; modelId: string; task: string; good: boolean; reason?: string }) {
  await db.insert(modelFeedback).values({ ...f, reason: f.reason?.slice(0, 200) ?? null });
}

/** Successful requests and tokens per provider/model since `start`. */
export async function usageSince(db: DB, userId: string, start: Date) {
  const rows = await db
    .select({
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.promptTokens} + ${usageEvents.completionTokens}), 0)::int`,
      estimatedTokens: sql<number>`coalesce(sum(case when ${usageEvents.estimated} then ${usageEvents.promptTokens} + ${usageEvents.completionTokens} else 0 end), 0)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.status, 'ok'), gte(usageEvents.createdAt, start)))
    .groupBy(usageEvents.provider, usageEvents.modelId);
  return new Map(rows.map((r) => [usageKey(r.provider, r.modelId), { requests: r.requests, tokens: r.tokens, estimatedTokens: r.estimatedTokens }]));
}

// ~chars/4, but an image is counted as a flat cost rather than its (huge) base64 length,
// so attaching a picture doesn't make the prompt look larger than any context window.
const IMAGE_TOKEN_COST = 900;

export function estimateTokens(value: unknown): number {
  if (Array.isArray(value) && value.every((m) => m && typeof m === 'object' && 'role' in (m as object))) {
    let total = 0;
    for (const m of value as { content?: unknown }[]) {
      total += 4; // per-message format overhead (role + delimiters), keeps the estimate conservative
      const content = m.content;
      if (typeof content === 'string') {
        total += content.length / 4;
      } else if (Array.isArray(content)) {
        for (const part of content as { type?: string; text?: string }[]) {
          if (part?.type === 'image_url') total += IMAGE_TOKEN_COST;
          else total += (part?.text ?? '').length / 4;
        }
      } else {
        total += JSON.stringify(content ?? '').length / 4;
      }
    }
    return Math.ceil(total);
  }
  return Math.ceil((JSON.stringify(value ?? '') ?? '').length / 4);
}
