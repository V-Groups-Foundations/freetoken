import { models } from '@/db/schema';
import { loadCredentials } from '@/keys/service';
import { keylessIds } from '@/providers/registry';
import { quality, parseTask, type Task } from '@/router/quality';
import { usageKey } from '@/router/select';
import { learnedScores } from '@/usage/ledger';
import type { Deps } from './deps';

/**
 * How auto routing currently ranks the user's models for one kind of task: the starting estimate,
 * what it learned from real results (requests, client feedback, benchmarks), and the total it sorts
 * by. Models of providers the user hasn't connected (and that need a key) are left out.
 */
export async function routerScores(deps: Deps, userId: string, taskParam: string | null, now = Date.now()) {
  const task: Task = parseTask(taskParam) ?? 'agent';
  const creds = await loadCredentials(deps.db, userId, deps.vaultKey);
  const keyless = new Set<string>(keylessIds());
  const catalog = (await deps.db.select().from(models)).filter((m) => m.enabled && (creds.has(m.provider) || keyless.has(m.provider)));
  const learned = await learnedScores(deps.db, userId, task, new Date(now - 14 * 86_400_000));
  const rows = catalog.map((m) => {
    const key = usageKey(m.provider, m.modelId);
    const base = quality(m.provider, m.modelId, task);
    const adj = learned.get(key) ?? 0;
    return { model: key, tier: m.tier, quality: base, learned: adj, score: Math.round((base + adj) * 10) / 10 };
  });
  return { task, models: rows.sort((a, b) => b.score - a.score || a.model.localeCompare(b.model)) };
}
