import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { usageEvents } from '@/db/schema';
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
}

export async function recordUsage(db: DB, e: UsageEvent) {
  await db.insert(usageEvents).values(e);
}

export async function usageToday(db: DB, userId: string, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await db
    .select({
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.promptTokens} + ${usageEvents.completionTokens}), 0)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.status, 'ok'), gte(usageEvents.createdAt, start)))
    .groupBy(usageEvents.provider, usageEvents.modelId);
  return new Map(rows.map((r) => [usageKey(r.provider, r.modelId), { requests: r.requests, tokens: r.tokens }]));
}

export function estimateTokens(value: unknown): number {
  return Math.ceil((JSON.stringify(value ?? '') ?? '').length / 4);
}
