import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { models } from '@/db/schema';
import { saveKey } from '@/keys/service';
import { recordFeedback } from '@/usage/ledger';
import { routerScores } from '@/server/router-scores';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import type { DB } from '@/db';

describe('router scores', () => {
  let db: DB;
  let userId: string;
  beforeEach(async () => {
    db = await createTestDb();
    userId = (await createUser(db)).id;
    await db.insert(models).values([
      { provider: 'groq', modelId: 'qwen/qwen3.8-27b', displayName: 'Qwen', tier: 'smart', priority: 1, contextWindow: 131072, supportsTools: true, rpd: null, tpd: null, enabled: true },
      { provider: 'groq', modelId: 'openai/gpt-oss-120b', displayName: 'GPT-OSS', tier: 'smart', priority: 2, contextWindow: 131072, supportsTools: true, rpd: null, tpd: null, enabled: true },
      { provider: 'cohere', modelId: 'command-a-03-2025', displayName: 'Command A', tier: 'smart', priority: 3, contextWindow: 131072, supportsTools: true, rpd: null, tpd: null, enabled: true },
    ]);
    await saveKey(db, userId, 'groq', 'gsk_x', null, TEST_VAULT_KEY);
  });
  it('ranks only connected models, and benchmark feedback moves them', async () => {
    const deps = { db, vaultKey: TEST_VAULT_KEY } as never;
    const before = await routerScores(deps, userId, 'agent');
    expect(before.models.map((m) => m.model)).toEqual(['groq/qwen/qwen3.8-27b', 'groq/openai/gpt-oss-120b']); // cohere isn't connected
    for (let i = 0; i < 6; i++) await recordFeedback(db, { userId, provider: 'groq', modelId: 'qwen/qwen3.8-27b', task: 'agent', good: false, reason: 'benchmark: fix-bug' });
    const after = await routerScores(deps, userId, 'agent');
    expect(after.models[0].model).toBe('groq/openai/gpt-oss-120b');
    expect(after.models[1].learned).toBeLessThan(0);
    expect((await routerScores(deps, userId, 'bogus')).task).toBe('agent');
  });
});
