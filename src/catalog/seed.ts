import type { models } from '@/db/schema';

type NewModel = typeof models.$inferInsert;

// Model IDs checked against provider docs 2026-10-13. Free-tier limits are approximate (null = unknown;
// the router still learns from 429s) and change often; edit rows in the DB rather than here.
export const SEED_MODELS: NewModel[] = [
  { provider: 'groq', modelId: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B', tier: 'smart', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 200000 },
  { provider: 'groq', modelId: 'qwen/qwen3.8-27b', displayName: 'Qwen 3.8 27B', tier: 'smart', priority: 15, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 200000 },
  { provider: 'groq', modelId: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B', tier: 'fast', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 500000 },
  { provider: 'gemini', modelId: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', tier: 'smart', priority: 20, contextWindow: 1048576, supportsTools: true },
  { provider: 'gemini', modelId: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', tier: 'fast', priority: 20, contextWindow: 1048576, supportsTools: true },
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3-super-120b-a12b:free', displayName: 'Nemotron 3 Super 120B (free)', tier: 'smart', priority: 40, contextWindow: 131072, supportsTools: false, rpm: 20, rpd: 50 },
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3.5-lightning:free', displayName: 'Nemotron 3.5 Lightning (free)', tier: 'fast', priority: 40, contextWindow: 131072, supportsTools: false, rpm: 20, rpd: 50 },
  { provider: 'openrouter', modelId: 'google/gemma-4-31b-it:free', displayName: 'Gemma 4 31B (free)', tier: 'smart', priority: 45, contextWindow: 131072, supportsTools: false, rpm: 20, rpd: 50 },
  { provider: 'github', modelId: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 mini', tier: 'smart', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  { provider: 'github', modelId: 'openai/gpt-4.1-nano', displayName: 'GPT-4.1 nano', tier: 'fast', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  // NVIDIA NIM — OpenAI-compatible, free (no card). IDs verified against integrate.api.nvidia.com/v1/models (2026-10-14).
  { provider: 'nvidia', modelId: 'nvidia/nemotron-3-super-120b-a12b', displayName: 'Nemotron 3 Super 120B', tier: 'smart', priority: 35, contextWindow: 131072, supportsTools: true },
  { provider: 'nvidia', modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b', displayName: 'Nemotron 3.5 Lightning 30B', tier: 'fast', priority: 35, contextWindow: 131072, supportsTools: true },
  { provider: 'nvidia', modelId: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B', tier: 'fast', priority: 36, contextWindow: 131072, supportsTools: true },
  // SambaNova — OpenAI-compatible, free tier (no card). Terms can change; verify in the dashboard.
  { provider: 'sambanova', modelId: 'Meta-Llama-3.3-70B-Instruct', displayName: 'Llama 3.3 70B', tier: 'smart', priority: 38, contextWindow: 131072, supportsTools: false },
  { provider: 'sambanova', modelId: 'Meta-Llama-3.1-8B-Instruct', displayName: 'Llama 3.1 8B', tier: 'fast', priority: 38, contextWindow: 131072, supportsTools: false },
  // Cohere — OpenAI-compatible (/compatibility/v1), free Trial key (~1,000 req/mo, non-commercial).
  { provider: 'cohere', modelId: 'command-a-03-2025', displayName: 'Command A', tier: 'smart', priority: 42, contextWindow: 256000, supportsTools: true, rpm: 20, rpd: 1000 },
  { provider: 'cohere', modelId: 'command-r7b-12-2024', displayName: 'Command R7B', tier: 'fast', priority: 42, contextWindow: 128000, supportsTools: true, rpm: 20, rpd: 1000 },
];
