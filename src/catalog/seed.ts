import type { models } from '@/db/schema';

type NewModel = typeof models.$inferInsert;

// Model IDs checked against provider docs 2026-10-13. Free-tier limits are approximate (null = unknown;
// the router still learns from 429s) and change often; edit rows in the DB rather than here.
export const SEED_MODELS: NewModel[] = [
  // Built-in keyless starter (Pollinations, anonymous tier): last resort, so priority 90.
  { provider: 'starter', modelId: 'openai', displayName: 'GPT-OSS 20B (starter, no key)', tier: 'smart', priority: 90, contextWindow: 131072, supportsTools: true },
  { provider: 'starter', modelId: 'openai-fast', displayName: 'GPT-OSS 20B fast (starter, no key)', tier: 'fast', priority: 90, contextWindow: 131072, supportsTools: true },
  // Keyless gateways (checked live 2026-10-19, anonymous, tools + streamed usage): after the user's own
  // providers, ahead of the Pollinations starter.
  { provider: 'kilo', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', displayName: 'Nemotron 3 Ultra 550B (Kilo, no key)', tier: 'smart', priority: 78, contextWindow: 262144, supportsTools: true },
  { provider: 'kilo', modelId: 'nvidia/nemotron-3.5-lightning:free', displayName: 'Nemotron 3.5 Lightning (Kilo, no key)', tier: 'fast', priority: 78, contextWindow: 262144, supportsTools: true },
  { provider: 'kilo', modelId: 'kilo-auto/free', displayName: 'Kilo Auto Free (no key)', tier: 'smart', priority: 82, contextWindow: 200000, supportsTools: true },
  { provider: 'llm7', modelId: 'codestral-latest', displayName: 'Codestral (LLM7, no key)', tier: 'fast', priority: 84, contextWindow: 32000, supportsTools: true },
  // Keyed free tiers (IDs from the providers' docs 2026-10-19; not live-tested without keys).
  { provider: 'cloudflare', modelId: '@cf/openai/gpt-oss-120b', displayName: 'GPT-OSS 120B (Workers AI)', tier: 'smart', priority: 30, contextWindow: 131072, supportsTools: true },
  { provider: 'cloudflare', modelId: '@cf/zai-org/glm-4.7-flash', displayName: 'GLM 4.7 Flash (Workers AI)', tier: 'fast', priority: 30, contextWindow: 131072, supportsTools: true },
  { provider: 'zai', modelId: 'glm-4.7-flash', displayName: 'GLM 4.7 Flash', tier: 'smart', priority: 32, contextWindow: 200000, supportsTools: true },
  { provider: 'zai', modelId: 'glm-4.5-flash', displayName: 'GLM 4.5 Flash', tier: 'fast', priority: 32, contextWindow: 128000, supportsTools: true },
  { provider: 'requesty', modelId: 'nvidia/nemotron-3-ultra-550b-a55b', displayName: 'Nemotron 3 Ultra 550B (Requesty)', tier: 'smart', priority: 44, contextWindow: 131072, supportsTools: true, rpm: 20 },
  { provider: 'requesty', modelId: 'google/gemma-4-31b-it', displayName: 'Gemma 4 31B (Requesty)', tier: 'fast', priority: 44, contextWindow: 131072, supportsTools: false, rpm: 20 },
  { provider: 'groq', modelId: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B', tier: 'smart', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 200000 },
  { provider: 'groq', modelId: 'qwen/qwen3.8-27b', displayName: 'Qwen 3.8 27B', tier: 'smart', priority: 15, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 200000 },
  { provider: 'groq', modelId: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B', tier: 'fast', priority: 10, contextWindow: 131072, supportsTools: true, rpm: 30, rpd: 1000, tpd: 500000 },
  { provider: 'gemini', modelId: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', tier: 'smart', priority: 20, contextWindow: 1048576, supportsTools: true },
  { provider: 'gemini', modelId: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', tier: 'fast', priority: 20, contextWindow: 1048576, supportsTools: true },
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3.5-lightning:free', displayName: 'Nemotron 3.5 Lightning (free)', tier: 'fast', priority: 40, contextWindow: 131072, supportsTools: false, rpm: 20, rpd: 50 },
  { provider: 'openrouter', modelId: 'google/gemma-4-31b-it:free', displayName: 'Gemma 4 31B (free)', tier: 'smart', priority: 45, contextWindow: 131072, supportsTools: false, rpm: 20, rpd: 50 },
  { provider: 'github', modelId: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 mini', tier: 'smart', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  { provider: 'github', modelId: 'openai/gpt-4.1-nano', displayName: 'GPT-4.1 nano', tier: 'fast', priority: 50, contextWindow: 8000, supportsTools: true, rpm: 15, rpd: 150 },
  // NVIDIA NIM — OpenAI-compatible, free (no card). IDs verified against integrate.api.nvidia.com/v1/models (2026-10-14).
  { provider: 'nvidia', modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b', displayName: 'Nemotron 3.5 Lightning 30B', tier: 'fast', priority: 35, contextWindow: 131072, supportsTools: true },
  { provider: 'nvidia', modelId: 'openai/gpt-oss-20b', displayName: 'GPT-OSS 20B', tier: 'fast', priority: 36, contextWindow: 131072, supportsTools: true },
  // NIM's strongest free agent models (each answered a tool call live, 2026-10-23)
  { provider: 'nvidia', modelId: 'deepseek-ai/deepseek-v4.1-flash', displayName: 'DeepSeek V4.1 Flash', tier: 'smart', priority: 12, contextWindow: 131072, supportsTools: true },
  { provider: 'nvidia', modelId: 'nvidia/nemotron-3-ultra-550b-a55b', displayName: 'Nemotron 3 Ultra 550B', tier: 'smart', priority: 14, contextWindow: 262144, supportsTools: true },
  { provider: 'nvidia', modelId: 'z-ai/glm-5.3-flash', displayName: 'GLM 5.3 Flash', tier: 'smart', priority: 16, contextWindow: 131072, supportsTools: true },
  { provider: 'nvidia', modelId: 'nvidia/nemotron-3.5-super-vl-120b-a12b', displayName: 'Nemotron 3.5 Super VL 120B', tier: 'smart', priority: 18, contextWindow: 131072, supportsTools: true },
  { provider: 'gemini', modelId: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', tier: 'smart', priority: 20, contextWindow: 1048576, supportsTools: true },
  { provider: 'cohere', modelId: 'command-a-reasoning-08-2025', displayName: 'Command A Reasoning', tier: 'smart', priority: 42, contextWindow: 256000, supportsTools: true, rpm: 20, rpd: 1000 },
  { provider: 'cohere', modelId: 'command-a-vision-07-2025', displayName: 'Command A Vision', tier: 'smart', priority: 43, contextWindow: 128000, supportsTools: false, rpm: 20, rpd: 1000 },
  { provider: 'cohere', modelId: 'command-a-plus-05-2026', displayName: 'Command A Plus', tier: 'smart', priority: 42, contextWindow: 256000, supportsTools: true, rpm: 20, rpd: 1000 },
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', displayName: 'Nemotron 3 Ultra 550B (free)', tier: 'smart', priority: 46, contextWindow: 262144, supportsTools: true, rpm: 20, rpd: 50 },
  // Cohere — OpenAI-compatible (/compatibility/v1), free Trial key (~1,000 req/mo, non-commercial).
  { provider: 'cohere', modelId: 'command-a-03-2025', displayName: 'Command A', tier: 'smart', priority: 42, contextWindow: 256000, supportsTools: true, rpm: 20, rpd: 1000 },
  { provider: 'cohere', modelId: 'command-r7b-12-2024', displayName: 'Command R7B', tier: 'fast', priority: 42, contextWindow: 128000, supportsTools: true, rpm: 20, rpd: 1000 },
];

/**
 * Catalog rows that no longer work for anyone (removed upstream, or the free tier ended): switched off
 * in existing databases when this list changes, so auto routing stops spending a try on each request.
 * A row the user switches back on stays on until the list changes again.
 */
export const RETIRED_MODELS: { provider: string; modelId: string; why: string }[] = [
  { provider: 'sambanova', modelId: 'Meta-Llama-3.3-70B-Instruct', why: 'the free tier now needs a payment method (402)' },
  { provider: 'sambanova', modelId: 'Meta-Llama-3.1-8B-Instruct', why: 'the free tier now needs a payment method (402)' },
  { provider: 'llm7', modelId: 'DeepSeek-V4-Flash-0731', why: '"currently unavailable" on every request' },
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3-super-120b-a12b:free', why: 'removed (404)' },
  { provider: 'nvidia', modelId: 'nvidia/nemotron-3-super-120b-a12b', why: 'removed (404)' },
];
