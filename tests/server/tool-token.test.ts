import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb, createUser } from '../helpers/db';
import { connectTool, type ToolEnv } from '@/server/tools-connect';
import { listTokens, revokeToken, tokenForTool } from '@/server/tokens';
import type { DB } from '@/db';

const BASE = 'http://localhost:3000/api/v1';

describe('the token a connected tool gets', () => {
  let db: DB;
  let userId: string;
  let env: ToolEnv;
  beforeEach(async () => {
    db = await createTestDb();
    userId = (await createUser(db)).id;
    const root = mkdtempSync(path.join(os.tmpdir(), 'ft-tooltok-'));
    env = { home: path.join(root, 'home'), binDir: path.join(root, 'bin'), repoRoot: path.join(root, 'repo'), platform: 'win32', installed: () => false };
  });
  const connect = async (tool: 'claude-code' | 'codex' | 'aider' | 'continue') => {
    const t = await tokenForTool(db, env, userId, tool, 'connect', BASE);
    connectTool(tool, env, BASE, t);
    return t;
  };

  it('tools run through the CLI share its one token (a new Connect no longer replaces it under the others)', async () => {
    const a = await connect('claude-code');
    const b = await connect('codex');
    const c = await connect('aider');
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect((await listTokens(db, userId)).map((t) => t.name)).toEqual(['CLI']);
  });

  it('a revoked CLI token is replaced; Continue and "Get a key" get their own', async () => {
    const a = await connect('claude-code');
    const [row] = await listTokens(db, userId);
    await revokeToken(db, userId, row.id);
    const b = await connect('codex');
    expect(b).not.toBe(a);
    const cont = await connect('continue');
    expect(cont).not.toBe(b);
    expect(await tokenForTool(db, env, userId, 'claude-code', 'key', BASE)).not.toBe(b);
    expect((await listTokens(db, userId)).map((t) => t.name).sort()).toEqual(['CLI', 'Claude Code', 'Continue']);
  });
});
