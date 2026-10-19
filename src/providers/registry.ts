export type ProviderId =
  | 'gemini' | 'groq' | 'openrouter' | 'github' | 'nvidia' | 'sambanova' | 'cohere'
  | 'cloudflare' | 'zai' | 'requesty' | 'kilo' | 'llm7' | 'starter';

export interface ProviderDef {
  id: ProviderId;
  name: string;
  keyUrl: string;
  steps: string[];
  note?: string;
  extraField?: { name: 'accountId'; label: string; pattern?: string; hint?: string };
  /** Cheap model used for the connect-time "Test" call. */
  validateModel: string;
  /** Works without a key (anonymous free tier): used out of the box; a key only raises the limits. */
  keyless?: boolean;
  baseUrl(extra?: string | null): string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    steps: ['Sign in to Google AI Studio.', 'Click "Create API key".', 'Copy the key and paste it here.'],
    note: 'On the free tier Google may use your prompts to improve its products. You can exclude Gemini from auto-routing.',
    validateModel: 'gemini-3.5-flash-lite',
    baseUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    id: 'groq',
    name: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    steps: ['Sign in to the Groq console.', 'Click "Create API Key".', 'Copy the key (starts with gsk_) and paste it here.'],
    validateModel: 'openai/gpt-oss-20b',
    baseUrl: () => 'https://api.groq.com/openai/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
    steps: ['Sign in to OpenRouter.', 'Click "Create Key".', 'Copy the key (starts with sk-or-) and paste it here.'],
    note: 'Only free (":free") models are used: 50 requests/day, or 1,000/day after a one-time $10 credit purchase.',
    validateModel: 'nvidia/nemotron-3.5-lightning:free',
    baseUrl: () => 'https://openrouter.ai/api/v1',
  },
  {
    id: 'github',
    name: 'GitHub Models',
    keyUrl: 'https://github.com/settings/personal-access-tokens/new',
    steps: ['Create a fine-grained personal access token.', 'Under permissions, set "Models" to read-only.', 'Generate and paste the token here.'],
    validateModel: 'openai/gpt-4.1-nano',
    baseUrl: () => 'https://models.github.ai/inference',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    keyUrl: 'https://build.nvidia.com',
    steps: [
      'Sign in at build.nvidia.com and join the free NVIDIA Developer Program (email only, no card).',
      'Open any model and click "Get API Key" — it starts with nvapi-.',
      'Copy the key and paste it here.',
    ],
    note: 'Free, no credit card — 100+ models with a per-minute rate limit.',
    validateModel: 'openai/gpt-oss-20b',
    baseUrl: () => 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'sambanova',
    name: 'SambaNova',
    keyUrl: 'https://cloud.sambanova.ai/apis',
    steps: [
      'Sign in at cloud.sambanova.ai (no card needed).',
      'Open "API Keys" and generate a key.',
      'Copy it immediately (shown once) and paste it here.',
    ],
    note: 'Free tier needs no card, but SambaNova has used trial credits before — check your dashboard for current limits.',
    validateModel: 'Meta-Llama-3.1-8B-Instruct',
    baseUrl: () => 'https://api.sambanova.ai/v1',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    steps: [
      'Sign in at dashboard.cohere.com (no card needed).',
      'Open "API Keys" and copy your Trial key.',
      'Paste it here.',
    ],
    note: 'Free Trial keys allow ~1,000 requests/month at 20/min, for non-commercial use. Uses Cohere\'s OpenAI-compatible endpoint.',
    validateModel: 'command-r7b-12-2024',
    baseUrl: () => 'https://api.cohere.ai/compatibility/v1',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    steps: [
      'Sign in to the Cloudflare dashboard (free account, no card).',
      'Copy your Account ID (right sidebar of any zone, or Workers & Pages → Overview).',
      'Profile → API Tokens → Create Token → "Workers AI" template → copy the token and paste it here.',
    ],
    note: 'Free every day: 10,000 "neurons" (roughly 100k+ tokens on GPT-OSS 120B), reset at 00:00 UTC.',
    extraField: { name: 'accountId', label: 'Account ID', pattern: '^[0-9a-f]{32}$', hint: '32 hex characters' },
    validateModel: '@cf/zai-org/glm-4.7-flash',
    baseUrl: (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId ?? ''}/ai/v1`,
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM Flash)',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    steps: ['Sign in at z.ai.', 'Open API Keys and create a key.', 'Copy it and paste it here.'],
    note: 'GLM Flash models are free (limited concurrency). Other GLM models are paid and never used here.',
    validateModel: 'glm-4.5-flash',
    baseUrl: () => 'https://api.z.ai/api/paas/v4',
  },
  {
    id: 'requesty',
    name: 'Requesty',
    keyUrl: 'https://app.requesty.ai/api-keys',
    steps: ['Sign up at app.requesty.ai (no card needed).', 'Create an API key.', 'Copy it and paste it here.'],
    note: 'Free models only: 200 requests/day and 20/minute, shared across them.',
    validateModel: 'google/gemma-4-31b-it',
    baseUrl: () => 'https://router.requesty.ai/v1',
  },
  {
    id: 'kilo',
    name: 'Kilo Gateway',
    keyless: true,
    keyUrl: 'https://app.kilo.ai',
    steps: ['Works without a key. Optional: sign in at app.kilo.ai, create an API key and paste it here.'],
    note: 'Free ":free" models (Nemotron Ultra 550B and more) with no key: about 200 requests/hour per network. Some free models may log prompts.',
    validateModel: 'nvidia/nemotron-3.5-lightning:free',
    baseUrl: () => 'https://ai-gateway.kilo.ai/api/v1',
  },
  {
    id: 'llm7',
    name: 'LLM7',
    keyless: true,
    keyUrl: 'https://dash.llm7.io',
    steps: ['Works without a key. Optional: get a free token at dash.llm7.io for higher limits (100k tokens/day) and paste it here.'],
    note: 'Free "turbo" models with no key; a free token raises the limits. Limits may change without notice.',
    validateModel: 'codestral-latest',
    baseUrl: () => 'https://api.llm7.io/v1',
  },
];

/** Providers usable with no key at all, the built-in starter included (FREETOKEN_STARTER=off turns them all off). */
export const keylessIds = (): ProviderId[] =>
  starterEnabled() ? ['starter', ...PROVIDERS.filter((p) => p.keyless).map((p) => p.id)] : [];

/**
 * Built in, no key: Pollinations' free anonymous tier (GPT-OSS 20B, tool calling included), so chat,
 * the API and V-Run work the moment FreeToken starts. It's the last resort — every connected provider
 * is tried first — and it's shared and rate-limited, so don't send it anything sensitive.
 * Turn it off with FREETOKEN_STARTER=off.
 */
export const STARTER: ProviderDef = {
  id: 'starter',
  name: 'Starter (built in, no key)',
  keyUrl: 'https://pollinations.ai',
  steps: [],
  note: 'Free and needs no key, so FreeToken works straight away. Shared and rate-limited — add your own free keys for speed and higher limits.',
  validateModel: 'openai',
  baseUrl: () => 'https://text.pollinations.ai/openai',
};
export const starterEnabled = () => (process.env.FREETOKEN_STARTER ?? '').toLowerCase() !== 'off';

export function getProvider(id: string): ProviderDef | undefined {
  return id === 'starter' ? STARTER : PROVIDERS.find((p) => p.id === id);
}

export type PublicProvider = Omit<ProviderDef, 'baseUrl' | 'validateModel'>;

export function toPublicProvider(def: ProviderDef): PublicProvider {
  const { id, name, keyUrl, steps, note, extraField, keyless } = def;
  return { id, name, keyUrl, steps, ...(note ? { note } : {}), ...(extraField ? { extraField } : {}), ...(keyless ? { keyless } : {}) };
}
