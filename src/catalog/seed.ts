import type { models } from '@/db/schema';

type NewModel = typeof models.$inferInsert;

// Free-tier limits are approximate (Oct 2026) and change often; edit rows in the DB rather than here.
export const SEED_MODELS: NewModel[] = [
  { provider: 'groq', modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', tier: 'smart', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 100000 },
  { provider: 'groq', modelId: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B', tier: 'smart', priority: 15, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 200000 },
  { provider: 'groq', modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B', tier: 'fast', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 14400, tpd: 500000 },
  { provider: 'gemini', modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', tier: 'smart', priority: 20, contextWindow: 1048576, supportsTools: true, rpm: 10, rpd: 250, tpd: null },
  { provider: 'gemini', modelId: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', tier: 'fast', priority: 20, contextWindow: 1048576, supportsTools: true, rpm: 15, rpd: 1000, tpd: null },
  { provider: 'cerebras', modelId: 'llama-3.3-70b', displayName: 'Llama 3.3 70B', tier: 'smart', priority: 25, contextWindow: 65536, supportsTools: true, rpm: 30, rpd: 14400, tpd: 1000000 },
  { provider: 'cerebras', modelId: 'llama3.1-8b', displayName: 'Llama 3.1 8B', tier: 'fast', priority: 25, contextWindow: 8192, supportsTools: true, rpm: 30, rpd: 14400, tpd: 1000000 },
  { provider: 'mistral', modelId: 'mistral-large-latest', displayName: 'Mistral Large', tier: 'smart', priority: 30, contextWindow: 131072, supportsTools: true },
  { provider: 'mistral', modelId: 'mistral-small-latest', displayName: 'Mistral Small', tier: 'fast', priority: 30, contextWindow: 32768, supportsTools: true },
  { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free', displayName: 'Llama 3.3 70B (free)', tier: 'smart', priority: 40, contextWindow: 131072, supportsTools: true, rpm: 20, rpd: 50 },
  { provider: 'github', modelId: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 mini', tier: 'smart', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  { provider: 'github', modelId: 'openai/gpt-4.1-nano', displayName: 'GPT-4.1 nano', tier: 'fast', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  { provider: 'cloudflare', modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', displayName: 'Llama 3.3 70B', tier: 'smart', priority: 60, contextWindow: 24000, supportsTools: false },
  { provider: 'cloudflare', modelId: '@cf/meta/llama-3.1-8b-instruct', displayName: 'Llama 3.1 8B', tier: 'fast', priority: 60, contextWindow: 7968, supportsTools: false },
];
