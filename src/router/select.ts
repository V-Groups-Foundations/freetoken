export interface CatalogModel {
  provider: string;
  modelId: string;
  displayName: string;
  tier: string;
  priority: number;
  contextWindow: number;
  supportsTools: boolean;
  rpd: number | null;
  tpd: number | null;
  enabled: boolean;
}

export interface SelectInput {
  requested: string;
  models: CatalogModel[];
  connected: { provider: string; excludedFromAuto: boolean }[];
  cooling: Set<string>;
  usageToday: Map<string, { requests: number; tokens: number }>;
  promptTokens: number;
  needsTools: boolean;
  needsVision?: boolean;
  canSee?: (provider: string, modelId: string) => boolean;
  /** what kind of request this is (auto routing ranks models by how good they are at it) */
  task?: Task;
  /** models the provider reports as having no requests left right now */
  exhausted?: Set<string>;
  /** failed / rate-limited attempts per model in the last few minutes */
  recentFailures?: Map<string, number>;
  /** providers used without the user's own key: shared, so the user's keys win a close call */
  keyless?: Set<string>;
}

const AUTO_TIERS = { 'auto-smart': 'smart', 'auto-fast': 'fast' } as const;

// Providers whose OpenAI-compatible tool-calling can't round-trip across turns: Gemini requires
// a `thought_signature` on each prior function call that the compat layer doesn't expose, so a
// multi-step agent task stalls on it. Excluded whenever a request carries tools.
export const TOOL_INCOMPATIBLE_PROVIDERS = new Set<string>(['gemini']);

import { quality, type Task } from './quality';

export function isAuto(ref: string): ref is keyof typeof AUTO_TIERS {
  return ref in AUTO_TIERS;
}

export function parseModelRef(ref: string): { provider: string; modelId: string } | null {
  const i = ref.indexOf('/');
  if (i <= 0 || i === ref.length - 1) return null;
  return { provider: ref.slice(0, i), modelId: ref.slice(i + 1) };
}

export const usageKey = (provider: string, modelId: string) => `${provider}/${modelId}`;

export function selectCandidates(input: SelectInput): CatalogModel[] {
  const connected = new Map(input.connected.map((c) => [c.provider, c]));

  const overLimit = (m: CatalogModel) => {
    const u = input.usageToday.get(usageKey(m.provider, m.modelId));
    if (!u) return false;
    return (m.rpd != null && u.requests >= m.rpd) || (m.tpd != null && u.tokens >= m.tpd);
  };
  const spent = (m: CatalogModel) => overLimit(m) || !!input.exhausted?.has(usageKey(m.provider, m.modelId));

  const usable = (m: CatalogModel) =>
    m.enabled &&
    connected.has(m.provider) &&
    !input.cooling.has(m.provider) &&
    m.contextWindow >= input.promptTokens + 1024 &&
    (!input.needsTools || (m.supportsTools && !TOOL_INCOMPATIBLE_PROVIDERS.has(m.provider))) &&
    (!input.needsVision || (input.canSee?.(m.provider, m.modelId) ?? false)) &&
    !spent(m);

  let tier: string;
  let first: CatalogModel[] = [];
  if (isAuto(input.requested)) {
    tier = AUTO_TIERS[input.requested];
  } else {
    const ref = parseModelRef(input.requested);
    const explicit = ref && input.models.find((x) => x.provider === ref.provider && x.modelId === ref.modelId);
    if (!explicit) return [];
    tier = explicit.tier;
    if (usable(explicit)) first = [explicit];
  }

  const pool = (t: string) => input.models.filter((m) => m.tier === t && !first.includes(m) && usable(m) && !connected.get(m.provider)!.excludedFromAuto);
  if (!isAuto(input.requested) || !input.task) {
    return [...first, ...pool(tier).sort((a, b) => a.priority - b.priority)];
  }
  // auto: the best model for this kind of task first; one that just failed or was rate-limited drops
  // back for a few minutes; ties go to the catalog's priority (the user's own order)
  const task = input.task;
  const shared = (m: CatalogModel) => (m.provider === 'starter' ? 40 : input.keyless?.has(m.provider) ? 4 : 0); // the built-in starter is a last resort
  const rank = (m: CatalogModel) => quality(m.provider, m.modelId, task) - shared(m) - 6 * Math.min(4, input.recentFailures?.get(usageKey(m.provider, m.modelId)) ?? 0);
  const byQuality = (a: CatalogModel, b: CatalogModel) => rank(b) - rank(a) || a.priority - b.priority;
  const main = pool(tier).sort(byQuality);
  // when every strong model is spent or failing, the other tier still answers (smart ⇄ fast)
  const other = pool(tier === 'smart' ? 'fast' : 'smart').sort(byQuality);
  return [...first, ...main, ...other];
}
