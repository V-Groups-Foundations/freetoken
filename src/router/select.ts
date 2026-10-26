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
  /** `attempts` (successes and errors, which providers count against a daily quota) when known */
  usageToday: Map<string, { requests: number; attempts?: number; tokens: number }>;
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
  /** what auto routing learned from real results for this task (score adjustment per model) */
  learned?: Map<string, number>;
  /** the most tokens one request may have, per model, as its provider reports (Groq: tokens per minute) */
  tokenCaps?: Map<string, number>;
  /** the model this conversation has been working with: kept while it works (switching mid-task loses the thread) */
  pinned?: string;
  /** the pinned model took over only because a better one was busy: that one gets it back when free */
  pinnedFallback?: boolean;
  /** measured output speed per model (tokens per second) */
  speed?: Map<string, number>;
}

const AUTO_TIERS = { 'auto-smart': 'smart', 'auto-fast': 'fast' } as const;
/** How much better (in score points) another model must be before a conversation leaves its own model. */
export const PIN_MARGIN = 8;

// Providers whose OpenAI-compatible tool calling can't round-trip across turns: excluded whenever a
// request carries tools. (Gemini needs a thought signature on each earlier function call; FreeToken
// keeps and restores those — see ./gemini — so it takes agent work like any other.)
export const TOOL_INCOMPATIBLE_PROVIDERS = new Set<string>();

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
    return (m.rpd != null && (u.attempts ?? u.requests) >= m.rpd) || (m.tpd != null && u.tokens >= m.tpd);
  };
  const spent = (m: CatalogModel) => overLimit(m) || !!input.exhausted?.has(usageKey(m.provider, m.modelId));
  // a prompt bigger than the model's token allowance is refused every time (Groq: 413): don't try
  const tooBig = (m: CatalogModel) => {
    const cap = input.tokenCaps?.get(usageKey(m.provider, m.modelId));
    return cap != null && input.promptTokens > cap;
  };

  const usable = (m: CatalogModel) =>
    m.enabled &&
    connected.has(m.provider) &&
    !input.cooling.has(m.provider) &&
    m.contextWindow >= input.promptTokens + 1024 &&
    (!input.needsTools || (m.supportsTools && !TOOL_INCOMPATIBLE_PROVIDERS.has(m.provider))) &&
    (!input.needsVision || (input.canSee?.(m.provider, m.modelId) ?? false)) &&
    !spent(m) && !tooBig(m);

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
  const rank = (m: CatalogModel) => rankParts(m, task, input).score;
  const byQuality = (a: CatalogModel, b: CatalogModel) => rank(b) - rank(a) || a.priority - b.priority;
  const main = pool(tier).sort(byQuality);
  // when every strong model is spent or failing, the other tier still answers (smart ⇄ fast)
  const other = pool(tier === 'smart' ? 'fast' : 'smart').sort(byQuality);
  // the conversation's own model goes first while it's usable and not failing — unless a clearly better
  // one is available (a top model that was busy earlier and is free again takes over)
  const pin = input.pinned && main.find((m) => usageKey(m.provider, m.modelId) === input.pinned);
  // A fallback pin (a slower model that answered while the best one was rate-limited) kept a whole
  // session on it after the best one was free again: it holds only while nothing better is available
  const better = input.pinnedFallback && pin && main[0] !== pin;
  if (pin && !better && (input.recentFailures?.get(input.pinned!) ?? 0) < 2 && rank(main[0]) - rank(pin) < PIN_MARGIN) {
    return [...first, pin, ...main.filter((m) => m !== pin), ...other];
  }
  return [...first, ...main, ...other];
}

/**
 * A little for writing fast, a little against writing slowly (±3 at most): between models of about the
 * same quality the quicker one wins — at 34 tokens a second every step of a long task took 40 seconds.
 */
export const speedBonus = (tps?: number) => (tps == null || !Number.isFinite(tps) ? 0 : Math.max(-3, Math.min(3, (tps - 50) / 8)));

/**
 * How auto routing scores one model for a task (higher first): its estimated quality, plus what it
 * learned from real results, minus a penalty for shared (keyless) providers — the built-in starter is a
 * last resort — and for failing in the last few minutes. The scores page shows these same numbers.
 */
export function rankParts(m: { provider: string; modelId: string }, task: Task,
  input: { learned?: Map<string, number>; recentFailures?: Map<string, number>; keyless?: Set<string>; speed?: Map<string, number> }) {
  const k = usageKey(m.provider, m.modelId);
  const quality_ = quality(m.provider, m.modelId, task);
  const learned = input.learned?.get(k) ?? 0;
  const shared = m.provider === 'starter' ? 40 : input.keyless?.has(m.provider) ? 4 : 0;
  const failing = 6 * Math.min(4, input.recentFailures?.get(k) ?? 0);
  const fast = speedBonus(input.speed?.get(k));
  return { quality: quality_, learned, shared, failing, speed: fast, score: quality_ + learned - shared - failing + fast };
}
