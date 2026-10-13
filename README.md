# FreeToken

Connect your own free-tier API keys from several AI providers, and use them through one
chat UI, one OpenAI-compatible API endpoint, and a terminal client. Every request is routed
to whichever of **your** providers still has free quota, with automatic fallback when one is
rate-limited.

> **What this is not.** FreeToken does not pool keys across users, log in to anyone's
> consumer app, or scrape provider dashboards. Each person connects their own API keys, and
> those keys only ever serve that person's own requests. Keys are encrypted at rest and never
> sent back to the browser.

## How it works

You paste your own free API keys (or connect OpenRouter in one click). For each request,
the router builds the list of models you can use, skips any provider that's cooling down or
over its known daily limit, calls the best one, and falls back to the next on a 429, 5xx, or
timeout. Every answer tells you which provider and model served it.

```
You ──► Chat UI  ┐
     ─► /api/v1   ┼─► Router ─► provider (OpenAI-compatible) ─► provider API
     ─► CLI      ┘      │
                  key vault · usage ledger · cooldowns
```

## Providers

All seven expose an OpenAI-compatible endpoint, so one generic client covers them. Free-tier
terms change often — connect what works for you.

| Provider | Get a key |
|---|---|
| Google Gemini | https://aistudio.google.com/apikey |
| Groq | https://console.groq.com/keys |
| OpenRouter | https://openrouter.ai/settings/keys (or one-click OAuth in the app) |
| Mistral | https://console.mistral.ai/api-keys |
| Cerebras | https://cloud.cerebras.ai |
| GitHub Models | https://github.com/settings/personal-access-tokens/new |
| Cloudflare Workers AI | https://dash.cloudflare.com/profile/api-tokens |

Claude, ChatGPT and DeepSeek have no free API tier, so they aren't in the free pool.

## Tech stack

Next.js 16 (App Router, TypeScript) · Drizzle ORM · PGlite for local dev and tests, Postgres
in production · Auth.js v5 (Google + a dev-only email login) · Tailwind CSS · Vitest. No
provider SDKs and no build step for the CLI.

## Getting started

Requires Node 22+.

```bash
npm install
cp .env.example .env.local
# fill in VAULT_MASTER_KEY and AUTH_SECRET (commands below)
npm run db:migrate
npm run db:seed
npm run dev        # http://localhost:3000
```

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # VAULT_MASTER_KEY
npx auth secret                                                               # AUTH_SECRET
```

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `pglite:./.data/pglite` for local dev; a Postgres URL in production |
| `VAULT_MASTER_KEY` | 32 random bytes (base64); encrypts stored provider keys |
| `AUTH_SECRET` | Auth.js session secret |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google sign-in (optional in dev) |
| `AUTH_DEV_LOGIN` | `true` enables a password-less email login (ignored in production) |

## Using it

**Chat UI** — sign in, connect a provider on `/connect`, chat on `/chat`. Each answer is
signed with the provider that produced it. `/dashboard` shows requests and tokens used today
and how much free quota is left per model.

**API** — create a token under `/settings`, then call it like the OpenAI API:

```bash
curl https://your-host/api/v1/chat/completions \
  -H "Authorization: Bearer ft_your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto-smart","messages":[{"role":"user","content":"ping"}]}'
```

Models: `auto-smart`, `auto-fast`, or any id from `GET /api/v1/models`. Works with any
OpenAI-compatible tool (Cline, Continue, scripts).

**Terminal client**

```bash
node bin/freetoken.mjs login          # save your base URL + ft_ token
node bin/freetoken.mjs                 # interactive chat
node bin/freetoken.mjs "one question"  # one-shot
```

Slash commands in the REPL: `/model <id>`, `/models`, `/clear`, `/help`, `/exit`. Config
lives in `~/.freetoken/config.json`; `FREETOKEN_TOKEN` and `FREETOKEN_BASE_URL` override it.

## Development

```bash
npm test          # Vitest (unit + integration, against in-memory PGlite)
npm run lint
npm run build
```

Project layout:

```
src/providers   provider registry + generic OpenAI-compatible client
src/router      candidate selection (pure) and routeChat (fallback, cooldowns)
src/keys        encrypted key storage and validation
src/usage       usage ledger, rate-limit parsing, dashboard summary
src/server      request handlers, API tokens, OpenRouter OAuth
src/cli         terminal client core (bin/freetoken.mjs is the entry)
src/app         Next.js pages and route handlers
docs/superpowers  the design spec and implementation plan
```

## Roadmap

Built: auth, connect keys, routing with fallback, chat UI, personal API, usage dashboard,
OpenRouter one-click connect, terminal client.

Next: our own rate limits (Upstash), an admin page for editing the model catalog, saved chat
history, email magic-link login, a privacy policy and terms, and deployment. See
`docs/superpowers/` for the spec and plan.

## Security

Provider keys are encrypted with AES-256-GCM before storage and decrypted only on the server
at request time. API tokens are stored only as hashes. A user's keys are loaded only by that
user's id, so they can never serve another user's request. Report security issues privately
rather than opening a public issue.
