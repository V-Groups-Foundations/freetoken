import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { models, providerKeys } from '@/db/schema';
import { getProvider } from '@/providers/registry';

export async function listUserModels(db: DB, userId: string) {
  const keys = await db.select({ provider: providerKeys.provider }).from(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.status, 'valid')));
  const connected = new Set(keys.map((k) => k.provider));
  const rows = await db.select().from(models).where(eq(models.enabled, true));
  return rows
    .filter((r) => connected.has(r.provider))
    .sort((a, b) => a.priority - b.priority || a.id - b.id)
    .map((r) => ({
      id: `${r.provider}/${r.modelId}`,
      name: `${r.displayName} · ${getProvider(r.provider)?.name ?? r.provider}`,
      tier: r.tier,
    }));
}
