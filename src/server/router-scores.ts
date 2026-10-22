import { models } from '@/db/schema';
import { loadCredentials } from '@/keys/service';
import { keylessIds } from '@/providers/registry';
import { parseTask, type Task } from '@/router/quality';
import { rankParts, usageKey } from '@/router/select';
import { learnedScores, recentFailures } from '@/usage/ledger';
import type { Deps } from './deps';

/**
 * How auto routing currently ranks the user's models for one kind of task: the starting estimate,
 * what it learned from real results (requests, client feedback, benchmarks), the penalties for a shared
 * (keyless) provider and for failing in the last 10 minutes, and the total it sorts by — the same numbers
 * routing uses. Models of providers the user hasn't connected (and that need a key) are left out.
 */
export async function routerScores(deps: Deps, userId: string, taskParam: string | null, now = Date.now()) {
  const task: Task = parseTask(taskParam) ?? 'agent';
  const creds = await loadCredentials(deps.db, userId, deps.vaultKey);
  const keyless = new Set<string>(keylessIds());
  const catalog = (await deps.db.select().from(models)).filter((m) => m.enabled && (creds.has(m.provider) || keyless.has(m.provider)));
  const learned = await learnedScores(deps.db, userId, task, new Date(now - 14 * 86_400_000));
  const failures = await recentFailures(deps.db, userId, new Date(now - 10 * 60_000));
  // shared only while the user has no key of their own for it (as routing decides)
  const sharedIds = new Set([...keyless].filter((id) => !creds.has(id)));
  const rows = catalog.map((m) => {
    const p = rankParts(m, task, { learned, recentFailures: failures, keyless: sharedIds });
    return { model: usageKey(m.provider, m.modelId), tier: m.tier, quality: p.quality, learned: p.learned, shared: p.shared, failing: p.failing,
      score: Math.round(p.score * 10) / 10 };
  });
  return { task, models: rows.sort((a, b) => b.score - a.score || a.model.localeCompare(b.model)) };
}
