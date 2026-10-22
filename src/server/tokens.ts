import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '@/db';
import { apiTokens } from '@/db/schema';
import { generateApiToken, hashApiToken } from '@/lib/tokens';
import { cliTokenFor, VIA_CLI, type ToolEnv, type ToolId } from './tools-connect';

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

/** Whose this token is, if it's still active (without counting as a use). */
export async function activeTokenOwner(db: DB, raw: string): Promise<string | null> {
  const [row] = await db.select({ userId: apiTokens.userId }).from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashApiToken(raw)), isNull(apiTokens.revokedAt)));
  return row?.userId ?? null;
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

export const TOOL_TOKEN_NAME: Record<ToolId, string> = {
  'claude-code': 'Claude Code', codex: 'Codex', aider: 'Aider', continue: 'Continue', freetoken: 'CLI', cursor: 'Cursor', cline: 'Cline',
};

/**
 * The token a tool gets on Connect / Get a key. Tools that run through `freetoken run` (the *-free
 * shims) share the CLI's one token: it's kept while still active — a new one per Connect replaced it
 * under every tool connected earlier, and piled up tokens. Anything else gets its own, named for it.
 */
export async function tokenForTool(db: DB, env: ToolEnv, ownerId: string, tool: ToolId, action: 'connect' | 'key', baseUrl: string) {
  if (action === 'connect' && VIA_CLI.has(tool)) {
    const current = cliTokenFor(env, baseUrl);
    if (current && (await activeTokenOwner(db, current)) === ownerId) return current;
    return createToken(db, ownerId, TOOL_TOKEN_NAME.freetoken);
  }
  return createToken(db, ownerId, TOOL_TOKEN_NAME[tool]);
}
