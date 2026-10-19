// Recognise provider API keys in whatever the user pastes — one key, several, or a whole .env file —
// and in this computer's environment variables. Keys with a distinctive shape are recognised by the
// key alone; the rest (Cohere, SambaNova) by their usual variable name.

export type DetectedKey = { provider: string; key: string; source: string };

const SHAPES: [RegExp, string][] = [
  [/^AIza[0-9A-Za-z_-]{30,}$/, 'gemini'],
  [/^gsk_[A-Za-z0-9]{20,}$/, 'groq'],
  [/^sk-or-v1-[A-Za-z0-9]{32,}$/, 'openrouter'],
  [/^nvapi-[A-Za-z0-9_-]{20,}$/, 'nvidia'],
  [/^(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,})$/, 'github'],
];

/** Common environment-variable names per provider. */
export const ENV_NAMES: Record<string, string[]> = {
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  nvidia: ['NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY', 'NGC_API_KEY'],
  github: ['GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'],
  sambanova: ['SAMBANOVA_API_KEY'],
  cohere: ['COHERE_API_KEY', 'CO_API_KEY'],
};
const BY_ENV = new Map(Object.entries(ENV_NAMES).flatMap(([p, names]) => names.map((n) => [n, p] as const)));

export const providerForKey = (key: string) => SHAPES.find(([re]) => re.test(key))?.[1] ?? null;

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2').trim();

/**
 * Find keys in pasted text. Lines like `GROQ_API_KEY=gsk_…` (with optional `export`, quotes or
 * `:`) use the variable name; anything else is matched by shape. One key per provider (the first).
 */
export function detectKeys(text: string): { found: DetectedKey[]; unrecognized: number } {
  const found = new Map<string, DetectedKey>();
  let unrecognized = 0;
  const add = (provider: string | null, key: string, source: string) => {
    if (!provider || key.length < 8) { unrecognized++; return; }
    if (!found.has(provider)) found.set(provider, { provider, key, source });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*[=:]\s*(.+)$/);
    if (kv) {
      const value = unquote(kv[2]);
      add(BY_ENV.get(kv[1]) ?? providerForKey(value), value, kv[1]);
      continue;
    }
    for (const token of line.split(/[\s,;]+/).map(unquote).filter(Boolean)) add(providerForKey(token), token, 'pasted');
  }
  return { found: [...found.values()], unrecognized };
}

/** Provider keys already set in environment variables on this computer (values stay server-side). */
export function detectEnvKeys(env: Record<string, string | undefined> = process.env): DetectedKey[] {
  const out: DetectedKey[] = [];
  for (const [provider, names] of Object.entries(ENV_NAMES)) {
    for (const name of names) {
      const v = env[name]?.trim();
      // GITHUB_TOKEN / GH_TOKEN are often unrelated tokens: only take them when they look like a PAT
      if (v && (provider !== 'github' || providerForKey(v) === 'github')) { out.push({ provider, key: v, source: name }); break; }
    }
  }
  return out;
}

export const maskKey = (k: string) => (k.length <= 10 ? '••••' : `${k.slice(0, 6)}…${k.slice(-4)}`);
