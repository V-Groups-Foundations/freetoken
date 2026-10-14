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
