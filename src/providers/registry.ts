export type ProviderId =
  | 'gemini' | 'groq' | 'openrouter' | 'mistral' | 'cerebras' | 'github' | 'cloudflare';

export interface ProviderDef {
  id: ProviderId;
  name: string;
  keyUrl: string;
  steps: string[];
  note?: string;
  extraField?: { name: 'accountId'; label: string };
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
    validateModel: 'gemini-2.5-flash-lite',
    baseUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    id: 'groq',
    name: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    steps: ['Sign in to the Groq console.', 'Click "Create API Key".', 'Copy the key (starts with gsk_) and paste it here.'],
    validateModel: 'llama-3.1-8b-instant',
    baseUrl: () => 'https://api.groq.com/openai/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
    steps: ['Sign in to OpenRouter.', 'Click "Create Key".', 'Copy the key (starts with sk-or-) and paste it here.'],
    note: 'Only free (":free") models are used: 50 requests/day, or 1,000/day after a one-time $10 credit purchase.',
    validateModel: 'meta-llama/llama-3.3-70b-instruct:free',
    baseUrl: () => 'https://openrouter.ai/api/v1',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    steps: ['Sign in to La Plateforme and choose the free "Experiment" plan.', 'Create a new API key.', 'Copy it and paste it here.'],
    validateModel: 'mistral-small-latest',
    baseUrl: () => 'https://api.mistral.ai/v1',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    keyUrl: 'https://cloud.cerebras.ai',
    steps: ['Sign in to Cerebras Cloud.', 'Open "API Keys" and create a key.', 'Copy it and paste it here.'],
    note: 'Cerebras free-tier terms have changed several times; check your console for current limits.',
    validateModel: 'llama3.1-8b',
    baseUrl: () => 'https://api.cerebras.ai/v1',
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
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    steps: ['Create an API token using the "Workers AI" template.', 'Copy the token and paste it here.', 'Copy your Account ID from the dashboard sidebar.'],
    extraField: { name: 'accountId', label: 'Account ID' },
    validateModel: '@cf/meta/llama-3.1-8b-instruct',
    baseUrl: (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
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
