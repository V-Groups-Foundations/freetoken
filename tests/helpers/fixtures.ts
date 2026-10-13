export const TEST_VAULT_KEY = Buffer.alloc(32, 7);

import type { DB } from '@/db';
import { models } from '@/db/schema';

export async function seedTestModels(db: DB) {
  await db.insert(models).values([
    { provider: 'groq', modelId: 'llama-70b', displayName: 'Llama 70B', tier: 'smart', priority: 1, contextWindow: 100000, supportsTools: true },
    { provider: 'gemini', modelId: 'flash', displayName: 'Flash', tier: 'smart', priority: 2, contextWindow: 100000, supportsTools: true },
    { provider: 'groq', modelId: 'llama-8b', displayName: 'Llama 8B', tier: 'fast', priority: 1, contextWindow: 100000, supportsTools: true },
  ]);
}
