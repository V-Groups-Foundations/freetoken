import type { models } from '@/db/schema';

type NewModel = typeof models.$inferInsert;

// Model IDs checked against provider docs 2026-10-13. Free-tier limits are approximate (null = unknown;
// the router still learns from 429s) and change often; edit rows in the DB rather than here.
export const SEED_MODELS: NewModel[] = [
  { provider: 'groq', modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', tier: 'smart', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 100000 },
  { provider: 'groq', modelId: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B', tier: 'smart', priority: 15, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 200000 },
  { provider: 'groq', modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B', tier: 'fast', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 14400, tpd: 500000 },
  { provider: 'gemini', modelId: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', tier: 'smart', priority: 20, contextWindow: 1048576, supportsTools: true },
  { provider: 'gemini', modelId: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', tier: 'fast', priority: 20, contextWindow: 1048576, supportsTools: true },
  { provider: 'cerebras', modelId: 'gpt-oss-120b', displayName: 'GPT-OSS 120B', tier: 'smart', priority: 25, contextWindow: 65536, supportsTools: true },
  { provider: 'cerebras', modelId: 'qwen-3.8-27b', displayName: 'Qwen 3.8 27B', tier: 'fast', priority: 25, contextWindow: 64000, supportsTools: true },
  { provider: 'mistral', modelId: 'mistral-large-latest', displayName: 'Mistral Large', tier: 'smart', priority: 30, contextWindow: 131072, supportsTools: true },
  { provider: 'mistral', modelId: 'mistral-small-latest', displayName: 'Mistral Small', tier: 'fast', priority: 30, contextWindow: 32768, supportsTools: true },
  { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free', displayName: 'Llama 3.3 70B (free)', tier: 'smart', priority: 40, contextWindow: 131072, supportsTools: true, rpm: 20, rpd: 50 },
  { provider: 'github', modelId: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 mini', tier: 'smart', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  { provider: 'github', modelId: 'openai/gpt-4.1-nano', displayName: 'GPT-4.1 nano', tier: 'fast', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  { provider: 'cloudflare', modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', displayName: 'Llama 3.3 70B', tier: 'smart', priority: 60, contextWindow: 24000, supportsTools: false },
  { provider: 'cloudflare', modelId: '@cf/meta/llama-3.1-8b-instruct', displayName: 'Llama 3.1 8B', tier: 'fast', priority: 60, contextWindow: 7968, supportsTools: false },
];
