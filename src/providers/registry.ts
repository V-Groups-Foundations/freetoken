export type ProviderId =
  | 'gemini' | 'groq' | 'openrouter' | 'github' | 'nvidia' | 'sambanova' | 'cohere';

export interface ProviderDef {
  id: ProviderId;
  name: string;
  keyUrl: string;
  steps: string[];
  note?: string;
  extraField?: { name: 'accountId'; label: string; pattern?: string; hint?: string };
  /** Cheap model used for the connect-time "Test" call. */
  validateModel: string;
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
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export type PublicProvider = Omit<ProviderDef, 'baseUrl' | 'validateModel'>;

export function toPublicProvider(def: ProviderDef): PublicProvider {
  const { id, name, keyUrl, steps, note, extraField } = def;
  return { id, name, keyUrl, steps, ...(note ? { note } : {}), ...(extraField ? { extraField } : {}) };
}
