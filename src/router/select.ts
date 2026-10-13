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
}

const AUTO_TIERS = { 'auto-smart': 'smart', 'auto-fast': 'fast' } as const;

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

  const usable = (m: CatalogModel) =>
    m.enabled &&
    connected.has(m.provider) &&
    !input.cooling.has(m.provider) &&
    m.contextWindow >= input.promptTokens + 1024 &&
    (!input.needsTools || m.supportsTools) &&
    !overLimit(m);

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

  const rest = input.models
    .filter((m) => m.tier === tier && !first.includes(m) && usable(m) && !connected.get(m.provider)!.excludedFromAuto)
    .sort((a, b) => a.priority - b.priority);

  return [...first, ...rest];
}
