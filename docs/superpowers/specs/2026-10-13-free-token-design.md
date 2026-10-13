# FreeToken — Design Spec

Date: 2026-10-13
Status: Draft, awaiting review

## 1. Purpose

A public website where each user connects their **own** API keys from providers that offer
free API tiers. The site merges those free quotas into one experience: a chat UI and a
personal OpenAI-compatible API endpoint that automatically routes each request to whichever
of the user's providers still has free quota.

Success: a user connects 3+ providers in under 5 minutes, chats or calls the API without
thinking about which provider answers, and rarely hits a "no quota left" wall.

### Hard rule: no key pooling
A user's keys only ever serve that user's requests. Keys are never shared across users, never
used for our own purposes, and never routed for anyone else. (Pooling would violate every
provider's ToS and get keys revoked.) This rule is enforced in the router: provider
credentials are always loaded by `userId` of the authenticated caller.

### Non-goals (v1)
- Logging in to consumer apps (claude.ai, chatgpt.com, etc.) or scraping web UIs.
- Paid providers (Anthropic, OpenAI, DeepSeek) — possible phase 2 as optional paid BYOK.
- Image/audio generation, embeddings, file uploads.
- Teams/organizations, billing.

## 2. Stack

- Next.js (App Router, TypeScript) — UI + API routes, deployed to Vercel.
- Postgres (Neon or Supabase) via Drizzle ORM.
- Redis (Upstash) — rate limits, cooldowns, hot usage counters.
- Auth.js — email magic link + Google OAuth.
- No provider SDKs: every launch provider exposes an OpenAI-compatible `/chat/completions`
  endpoint, so one generic HTTP client + a per-provider registry entry covers all of them.
- PGlite (embedded Postgres) for local dev and tests; real Postgres in production.
- Vitest for unit/integration tests, Playwright for a small e2e smoke suite.

## 3. Architecture

```
Browser ──► Next.js app
             ├─ /connect        provider cards, paste key, Test, save
             ├─ /chat           chat UI (streams via /api/chat)
             ├─ /dashboard      usage + remaining free quota estimate
             ├─ /settings       API tokens, provider exclusions, delete account
             ├─ /admin          model catalog / limits editor (admin role only)
             ├─ /api/chat                    ┐
             └─ /api/v1/chat/completions     ┴─► Router ─► Provider modules ─► provider APIs
                                                  │
                                    Key vault (decrypt) · Usage ledger · Cooldowns (Redis)
```

### Units
- **Provider modules** (`src/providers/<id>.ts`): one per provider, common interface:
  `validateKey(key)`, `listModels(key)`, `chat(req, key) → stream`, `parseRateLimit(headers)`.
  Adding a provider = one file + catalog rows.
- **Key vault** (`src/vault`): `encrypt(plaintext)`, `decrypt(blob)`, AES-256-GCM, master
  key from `VAULT_MASTER_KEY` env var (32 bytes, base64). Stores version byte for rotation.
- **Model catalog** (`models` table, seeded from `src/catalog/seed.ts`): provider, model id,
  tier (`smart`|`fast`), context window, supports tools, known free limits (rpm, rpd, tpd —
  all nullable). Editable from `/admin` without redeploy.
- **Usage ledger** (`src/usage`): records each request; answers "is provider P likely over
  its limit for user U today?"
- **Router** (`src/router`): pure selection logic + an executor that performs fallback.
- **Entry points**: `/api/chat` (session auth) and `/api/v1/chat/completions`
  (Bearer `ft_…` token auth). Both translate to one internal request shape and call the Router.

## 4. Providers at launch

| id | Name | Key page | Notes |
|---|---|---|---|
| gemini | Google Gemini | https://aistudio.google.com/apikey | Free-tier prompts may be used by Google to improve products — shown on card; user can exclude from auto |
| groq | Groq | https://console.groq.com/keys | ~1k req/day, 30 rpm on main models |
| openrouter | OpenRouter | https://openrouter.ai/settings/keys | Only `:free` models used; 20 rpm, 50/day (1k/day after $10 lifetime top-up) |
| mistral | Mistral | https://console.mistral.ai/api-keys | Monthly free credit |
| cerebras | Cerebras | https://cloud.cerebras.ai | Free-tier terms uncertain; card says so |
| github | GitHub Models | https://github.com/settings/tokens | Fine-grained PAT with `models:read` |
| cloudflare | Cloudflare Workers AI | https://dash.cloudflare.com/profile/api-tokens | Needs API token + account ID (two fields) |

Each card: link to key page, 2–4 step "how to get your key", input field(s), **Test** button
(cheap real call via `validateKey`), status badge (connected / invalid / cooling down),
last-4 chars display, remove button. Keys are only saved after a successful Test.

## 5. Routing

Input: `{ userId, model: "<provider>/<model>" | "auto-smart" | "auto-fast", messages, tools?, stream }`.

1. Load user's connected, non-excluded providers.
2. Build candidates:
   - explicit model → just that model (no fallback unless user enabled "fallback on explicit
     model" in settings, default on, falls back within same tier);
   - `auto-*` → all catalog models of that tier from connected providers, ordered by catalog
     `priority`.
3. Filter: context window ≥ estimated prompt tokens + 1k; supports tools if tools present.
4. Skip: provider in cooldown for this user (Redis key `cd:{userId}:{provider}`), or ledger
   estimates today's usage ≥ known rpd/tpd.
5. Execute best candidate. On 429 / 5xx / timeout (30s to first byte): set cooldown
   (use `retry-after` if present, else 60s for 429, 30s for 5xx) and try next.
   On 401/403: mark the key `invalid`, notify user on next page load, try next.
6. Streaming: fallback only before first token. Mid-stream failure → error event; client
   shows "retry" button.
7. All candidates exhausted → 429 to client with message
   "All your connected providers are out of free quota or unavailable. Earliest reset: <time>.
   Connect more providers to increase your quota." plus link to /connect.
8. Every response carries which provider/model answered (`x-freetoken-provider` header on the
   API; a label under each chat message).

## 6. Data model (Postgres)

- `users` (Auth.js standard tables + `role` enum `user|admin`, `created_at`).
- `provider_keys`: id, user_id FK, provider, encrypted_key (bytea), extra_encrypted (bytea,
  nullable, e.g. Cloudflare account id), last4, status (`valid|invalid`), excluded_from_auto
  bool, created_at, last_used_at. Unique (user_id, provider).
- `api_tokens`: id, user_id, name, token_hash (SHA-256), prefix (first 8 chars for display),
  created_at, last_used_at, revoked_at. Raw token shown once at creation.
- `models`: id, provider, model_id, display_name, tier, priority, context_window,
  supports_tools, rpm, rpd, tpd (nullable), enabled.
- `usage_events`: id, user_id, provider, model_id, source (`chat|api`), prompt_tokens,
  completion_tokens, status (`ok|rate_limited|error`), latency_ms, created_at.
  Indexed (user_id, provider, created_at). **No message content stored.**
- `conversations`, `messages`: chat history for the chat UI only (user can delete any time;
  account deletion cascades).

## 7. Security & public-launch protections

- **Key handling:** encrypted at rest (AES-256-GCM, random 12-byte IV per value). Decrypted
  only server-side in the request path. Never returned to the browser, never logged
  (logger redacts `key`, `authorization`, `token` fields). `VAULT_MASTER_KEY` only in Vercel
  env.
- **API tokens:** `ft_` + 32 random bytes base62; only hash stored; constant-time compare.
- **Our own rate limits** (Upstash ratelimit): per user 60 req/min and 2,000 req/day across
  everything; per IP 10 sign-ups/hour; per user 20 key-Test calls/hour. Protects us and the
  user's keys from runaway scripts.
- **Abuse:** request body max 1 MB; max 200 messages per request; admin can suspend a user.
- **Web hardening:** CSRF via Auth.js, strict CSP, secure/httpOnly cookies, input validation
  with zod on every route.
- **Account deletion:** wipes keys, tokens, chats, usage immediately.
- **Legal pages:** Privacy Policy and Terms (plain-language; state that keys are the user's,
  used only for their requests, encrypted, deletable; content passes through to the provider
  they connected). Must exist before public launch.

## 8. Error handling

- Provider errors normalized to `{ kind: "rate_limit"|"auth"|"server"|"timeout"|"bad_request",
  retryAfterMs? }` by each provider module; router acts only on `kind`.
- `bad_request` (e.g. context too long) is not retried on other providers unless context
  window was the cause, in which case it moves to a larger-context candidate.
- API errors follow OpenAI error JSON shape so existing clients handle them.

## 9. Dashboard

Per provider: requests/tokens today, known limit (if any), estimated remaining, cooldown
status, next reset. Top: "≈ N free requests left today across all providers" (sum of
estimated remaining where known; "unknown" providers listed separately).

## 10. Testing

- Unit: vault round-trip and tamper detection; router candidate selection, filtering,
  cooldown skipping, fallback order, mid-stream no-fallback rule; token hashing; error
  normalization per provider (from recorded fixtures).
- Integration: `/api/v1/chat/completions` against mock provider servers (MSW) — success,
  429 fallback, all-exhausted, invalid key, auth failures.
- E2E (Playwright): sign up → connect mock provider → chat → see answer + provider label.
- No real provider calls in CI; an optional manual `pnpm smoke` script tests real keys from
  local `.env`.

## 11. Build order

1. Scaffold, DB schema, auth.
2. Vault + provider modules (Groq and Gemini first) + `/connect`.
3. Router + `/api/chat` + chat UI.
4. API tokens + `/api/v1/chat/completions`.
5. Remaining providers, usage ledger, dashboard.
6. Rate limits, admin catalog editor, legal pages, deploy.
