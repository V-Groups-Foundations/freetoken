import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '@/db';
import { apiTokens } from '@/db/schema';
import { generateApiToken, hashApiToken } from '@/lib/tokens';

export async function createToken(db: DB, userId: string, name: string): Promise<string> {
  const t = generateApiToken();
  await db.insert(apiTokens).values({ userId, name, tokenHash: t.hash, prefix: t.prefix });
  return t.raw;
}

export async function listTokens(db: DB, userId: string) {
  return db
    .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(apiTokens.createdAt);
}

export async function revokeToken(db: DB, userId: string, id: number) {
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)));
}

export async function userIdFromBearer(db: DB, header: string | null): Promise<string | null> {
  const raw = header?.match(/^Bearer\s+(ft_\S+)$/i)?.[1];
  if (!raw) return null;
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashApiToken(raw)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return row.userId;
}
