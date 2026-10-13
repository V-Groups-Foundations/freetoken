# FreeToken Core (Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working multi-user Next.js app where a user signs in, connects their own free-tier provider API keys, and chats (web UI) or calls a personal OpenAI-compatible endpoint that routes across their providers with automatic fallback.

**Architecture:** Every launch provider exposes an OpenAI-compatible `/chat/completions` endpoint, so a single generic provider client + a per-provider registry entry replaces per-provider SDKs. A pure `selectCandidates` function orders models; `routeChat` executes with cooldowns (KV), invalid-key marking, and usage recording. Route handlers are thin wrappers over handler functions that take injected deps, so everything important is tested against in-memory PGlite and a fake `fetch`.

**Tech Stack:** Next.js 16 (App Router, TS, Tailwind), Drizzle ORM, PGlite (dev/test) / Postgres via `pg` (prod), Auth.js v5 (`next-auth@beta`) with Drizzle adapter, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-free-token-design.md`

**Out of scope (Plan 2):** Upstash KV + our own rate limits, usage dashboard, `/admin` catalog editor, chat history persistence, email magic-link login, legal pages, Playwright e2e, Vercel deploy.

## Global Constraints

- Node 22 + npm (no pnpm, no Docker). Dev DB URL `pglite:./.data/pglite`; tests use in-memory `pglite:`.
- A user's provider keys serve only that user: credentials are loaded exclusively by the authenticated caller's `userId`.
- Decrypted keys are never returned to the browser or logged; APIs expose `last4` only.
- Model refs are `provider/modelId`, split on the **first** `/` (OpenRouter/Cloudflare IDs contain slashes). Virtual models: `auto-smart`, `auto-fast`.
- Upstream: OpenAI chat-completions format for all providers; no `stream_options` sent (some providers reject it).
- Cooldowns: 429 → `retry-after` or 60 s; 5xx/404/network/timeout → 30 s. Timeout = 30 s to response headers.
- Request body ≤ 1 MB, ≤ 200 messages.
- Every successful response carries header `x-freetoken-provider: <provider>/<modelId>`.
- Fallback only before the first byte of a streamed response.

## Review Focus

1. Model IDs containing `/` (e.g. `openrouter/meta-llama/llama-3.3-70b-instruct:free`) → parsed correctly (Task 5 test).
2. Upstream returns an HTML/non-JSON error body (e.g. 502 from a proxy) → normalized, router falls back, no crash (Task 4 + Task 8 tests).
3. Streamed response with no usage chunk → usage still recorded with estimated tokens (Task 7 test).
4. Key is valid but rate-limited at Test time (429) → saved, with a note, not rejected (Task 6 test).
5. User with zero connected providers or an unknown model → clear 400/404 message, not a generic 429 (Task 8 tests).

---

## File Structure

```
next.config.ts, vitest.config.ts, drizzle.config.ts, .env.example
scripts/migrate.ts, scripts/seed.ts
src/db/schema.ts            all tables
src/db/index.ts             createDb(url), getDb(), DB type
src/db/migrations.ts        runMigrations(db, url)
src/lib/vault.ts            AES-256-GCM encrypt/decrypt
src/lib/tokens.ts           ft_ API token generate/hash
src/lib/kv.ts               KV interface + memory impl
src/providers/registry.ts   ProviderDef list
src/providers/client.ts     callChat, normalizeError
src/catalog/seed.ts         SEED_MODELS
src/router/select.ts        pure candidate selection
src/router/execute.ts       routeChat
src/router/models.ts        listUserModels
src/usage/ledger.ts         recordUsage, usageToday, estimateTokens
src/usage/tap.ts            tapSseUsage
src/keys/service.ts         saveKey, listKeys, removeKey, setExcluded, markInvalid, loadCredentials, validateKey
src/server/deps.ts          Deps type + getDeps()
src/server/chat-body.ts     validateChatBody
src/server/keys-handlers.ts handleSaveKey
src/server/tokens.ts        createToken, listTokens, revokeToken, userIdFromBearer
src/server/v1.ts            handleCompletions, handleModels
src/auth.ts, src/lib/session.ts
src/app/...                 pages + route handlers
tests/helpers/{db,fake-fetch,fixtures}.ts, tests/**/*.test.ts
```

---

### Task 1: Scaffold, tooling, database

**Files:**
- Create: project scaffold (create-next-app), `next.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `.env.example`, `src/db/schema.ts`, `src/db/index.ts`, `src/db/migrations.ts`, `scripts/migrate.ts`, `tests/helpers/db.ts`, `tests/db.test.ts`

**Interfaces:**
- Produces: `createDb(url: string): DB`, `getDb(): DB`, `type DB`, `runMigrations(db: DB, url: string): Promise<void>`, tables `users, accounts, sessions, verificationTokens, providerKeys, apiTokens, models, usageEvents`; test helpers `createTestDb(): Promise<DB>`, `createUser(db, email?): Promise<{ id: string; email: string | null }>`.

- [ ] **Step 1: Scaffold** (create-next-app refuses non-empty dirs, so move docs aside)

```bash
cd /c/Users/10534.ADTW/Desktop/free_token
mv docs ../_ft_docs_tmp
npx create-next-app@16 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack --yes
mv ../_ft_docs_tmp docs
npm i drizzle-orm @electric-sql/pglite pg next-auth@beta @auth/drizzle-adapter zod
npm i -D drizzle-kit vitest tsx @types/pg
```
If npm reports a peer-dependency conflict for `next-auth` with Next 16, rerun that install with `--legacy-peer-deps`.

- [ ] **Step 2: Config files**

`next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
```

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({ schema: './src/db/schema.ts', out: './drizzle', dialect: 'postgresql' });
```

`.env.example`:
```
DATABASE_URL=pglite:./.data/pglite
# 32 random bytes, base64: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
VAULT_MASTER_KEY=
# npx auth secret
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
# dev-only email login without a password (ignored in production)
AUTH_DEV_LOGIN=true
```
Copy to `.env.local` and fill `VAULT_MASTER_KEY` and `AUTH_SECRET`. Append `.data/` to `.gitignore`.

Add to `package.json` scripts:
```json
"test": "vitest run",
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx --env-file=.env.local scripts/migrate.ts",
"db:seed": "tsx --env-file=.env.local scripts/seed.ts"
```

- [ ] **Step 3: Schema** — `src/db/schema.ts`

```ts
import {
  pgTable, text, timestamp, integer, boolean, serial, primaryKey, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import type { AdapterAccountType } from 'next-auth/adapters';

export const users = pgTable('user', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const accounts = pgTable('account', {
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').$type<AdapterAccountType>().notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('providerAccountId').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable('verificationToken', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

export const providerKeys = pgTable('provider_keys', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  encryptedExtra: text('encrypted_extra'),
  last4: text('last4').notNull(),
  status: text('status').notNull().default('valid'), // valid | invalid
  excludedFromAuto: boolean('excluded_from_auto').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
}, (t) => [uniqueIndex('provider_keys_user_provider').on(t.userId, t.provider)]);

export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
});

export const models = pgTable('models', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  displayName: text('display_name').notNull(),
  tier: text('tier').notNull(), // smart | fast
  priority: integer('priority').notNull(),
  contextWindow: integer('context_window').notNull(),
  supportsTools: boolean('supports_tools').notNull().default(false),
  rpm: integer('rpm'),
  rpd: integer('rpd'),
  tpd: integer('tpd'),
  enabled: boolean('enabled').notNull().default(true),
}, (t) => [uniqueIndex('models_provider_model').on(t.provider, t.modelId)]);

export const usageEvents = pgTable('usage_events', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  source: text('source').notNull(), // chat | api
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  status: text('status').notNull(), // ok | rate_limited | error
  latencyMs: integer('latency_ms').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('usage_user_provider_time').on(t.userId, t.provider, t.createdAt)]);
```

- [ ] **Step 4: DB client + migrations**

`src/db/index.ts`:
```ts
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

// "pglite:" = in-memory, "pglite:<dir>" = on-disk PGlite, anything else = Postgres URL.
export function createDb(url: string): DB {
  if (url.startsWith('pglite:')) {
    const dir = url.slice('pglite:'.length);
    return drizzlePglite(dir ? new PGlite(dir) : new PGlite(), { schema }) as unknown as DB;
  }
  return drizzlePg(new Pool({ connectionString: url }), { schema }) as unknown as DB;
}

const g = globalThis as unknown as { __ftDb?: DB };

export function getDb(): DB {
  if (!g.__ftDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__ftDb = createDb(url);
  }
  return g.__ftDb;
}
```

`src/db/migrations.ts`:
```ts
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { DB } from './index';

export async function runMigrations(db: DB, url: string): Promise<void> {
  const config = { migrationsFolder: 'drizzle' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (url.startsWith('pglite:')) await migratePglite(db as any, config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  else await migratePg(db as any, config);
}
```

`scripts/migrate.ts`:
```ts
import { createDb } from '../src/db';
import { runMigrations } from '../src/db/migrations';

const url = process.env.DATABASE_URL!;
await runMigrations(createDb(url), url);
console.log('migrations applied');
process.exit(0);
```

`tests/helpers/db.ts`:
```ts
import { createDb, type DB } from '@/db';
import { runMigrations } from '@/db/migrations';
import { users } from '@/db/schema';

export async function createTestDb(): Promise<DB> {
  const db = createDb('pglite:');
  await runMigrations(db, 'pglite:');
  return db;
}

export async function createUser(db: DB, email = `u${crypto.randomUUID()}@test.dev`) {
  const [u] = await db.insert(users).values({ email }).returning();
  return u;
}
```

- [ ] **Step 5: Write test** — `tests/db.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from './helpers/db';
import { users } from '@/db/schema';

describe('database', () => {
  it('migrates and stores users', async () => {
    const db = await createTestDb();
    const u = await createUser(db, 'a@test.dev');
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.email).toBe('a@test.dev');
    expect(row.role).toBe('user');
  });
});
```

- [ ] **Step 6: Generate migrations, run test, build**

Run: `npm run db:generate && npm test && npm run db:migrate && npm run build`
Expected: migration SQL in `drizzle/`, 1 test passes, "migrations applied", build succeeds.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: scaffold Next.js app with Drizzle schema and PGlite"
```

---

### Task 2: Vault, API tokens, KV

**Files:**
- Create: `src/lib/vault.ts`, `src/lib/tokens.ts`, `src/lib/kv.ts`, `tests/lib/vault.test.ts`, `tests/lib/tokens-kv.test.ts`, `tests/helpers/fixtures.ts`

**Interfaces:**
- Produces: `encrypt(plain: string, key?: Buffer): string`, `decrypt(blob: string, key?: Buffer): string`, `loadMasterKey(b64?: string): Buffer`, `generateApiToken(): { raw: string; hash: string; prefix: string }`, `hashApiToken(raw: string): string`, `interface KV { get(k): Promise<string|null>; set(k, v, ttlMs): Promise<void> }`, `createMemoryKV(now?: () => number): KV`, `getKV(): KV`, fixture `TEST_VAULT_KEY: Buffer`.

- [ ] **Step 1: Write failing tests**

`tests/helpers/fixtures.ts`:
```ts
export const TEST_VAULT_KEY = Buffer.alloc(32, 7);
```

`tests/lib/vault.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, loadMasterKey } from '@/lib/vault';
import { TEST_VAULT_KEY } from '../helpers/fixtures';

describe('vault', () => {
  it('round-trips', () => {
    expect(decrypt(encrypt('gsk_secret', TEST_VAULT_KEY), TEST_VAULT_KEY)).toBe('gsk_secret');
  });
  it('uses a fresh IV each time', () => {
    expect(encrypt('x', TEST_VAULT_KEY)).not.toBe(encrypt('x', TEST_VAULT_KEY));
  });
  it('rejects tampered ciphertext', () => {
    const buf = Buffer.from(encrypt('secret', TEST_VAULT_KEY), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString('base64'), TEST_VAULT_KEY)).toThrow();
  });
  it('rejects the wrong key', () => {
    expect(() => decrypt(encrypt('s', TEST_VAULT_KEY), Buffer.alloc(32, 8))).toThrow();
  });
  it('validates master key length', () => {
    expect(() => loadMasterKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => loadMasterKey('')).toThrow(/not set/);
  });
});
```

`tests/lib/tokens-kv.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken } from '@/lib/tokens';
import { createMemoryKV } from '@/lib/kv';

describe('api tokens', () => {
  it('generates ft_ tokens whose hash matches', () => {
    const t = generateApiToken();
    expect(t.raw.startsWith('ft_')).toBe(true);
    expect(t.raw.length).toBeGreaterThan(40);
    expect(t.hash).toBe(hashApiToken(t.raw));
    expect(t.raw.startsWith(t.prefix)).toBe(true);
    expect(generateApiToken().raw).not.toBe(t.raw);
  });
});

describe('memory KV', () => {
  it('expires entries', async () => {
    let now = 1000;
    const kv = createMemoryKV(() => now);
    await kv.set('a', '1', 500);
    expect(await kv.get('a')).toBe('1');
    now = 1500;
    expect(await kv.get('a')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/vault.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Blob layout (base64): [version:1][iv:12][tag:16][ciphertext]
const VERSION = 1;

export function loadMasterKey(b64: string | undefined = process.env.VAULT_MASTER_KEY): Buffer {
  if (!b64) throw new Error('VAULT_MASTER_KEY is not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('VAULT_MASTER_KEY must be 32 bytes (base64)');
  return key;
}

export function encrypt(plaintext: string, key: Buffer = loadMasterKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(blob: string, key: Buffer = loadMasterKey()): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf[0] !== VERSION) throw new Error('Unsupported vault blob version');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
}
```

`src/lib/tokens.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';

export function hashApiToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateApiToken() {
  const raw = 'ft_' + randomBytes(32).toString('base64url');
  return { raw, hash: hashApiToken(raw), prefix: raw.slice(0, 10) };
}
```

`src/lib/kv.ts`:
```ts
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

// Per-process store. Plan 2 swaps in Upstash Redis for multi-instance deploys.
export function createMemoryKV(now: () => number = Date.now): KV {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, ttlMs) {
      store.set(key, { value, expiresAt: now() + ttlMs });
    },
  };
}

const g = globalThis as unknown as { __ftKv?: KV };

export function getKV(): KV {
  return (g.__ftKv ??= createMemoryKV());
}
```

- [ ] **Step 4: Run** `npm test` — Expected: all pass.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: add key vault, API token helpers, memory KV"`

---

### Task 3: Provider registry

**Files:**
- Create: `src/providers/registry.ts`, `tests/providers/registry.test.ts`

**Interfaces:**
- Produces: `type ProviderId`, `interface ProviderDef { id; name; keyUrl; steps: string[]; note?: string; extraField?: { name: 'accountId'; label: string }; validateModel: string; baseUrl(extra?: string | null): string }`, `PROVIDERS: ProviderDef[]`, `getProvider(id: string): ProviderDef | undefined`, `type PublicProvider` + `toPublicProvider(def)` (serializable, no functions).

- [ ] **Step 1: Write failing test** — `tests/providers/registry.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, toPublicProvider } from '@/providers/registry';

describe('provider registry', () => {
  it('has the seven launch providers with https key pages', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(
      ['cerebras', 'cloudflare', 'gemini', 'github', 'groq', 'mistral', 'openrouter'],
    );
    for (const p of PROVIDERS) expect(p.keyUrl).toMatch(/^https:\/\//);
  });
  it('builds the Cloudflare base URL from the account id', () => {
    expect(getProvider('cloudflare')!.baseUrl('abc123')).toBe(
      'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1',
    );
  });
  it('public view is serializable', () => {
    const pub = toPublicProvider(getProvider('groq')!);
    expect(JSON.parse(JSON.stringify(pub))).toEqual(pub);
    expect(getProvider('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/providers/registry.ts`

```ts
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

export function toPublicProvider({ baseUrl: _b, validateModel: _v, ...rest }: ProviderDef): PublicProvider {
  return rest;
}
```

- [ ] **Step 4: Run** `npm test` — Expected: pass.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: add provider registry for seven free-tier providers"`

---

### Task 4: Provider client + error normalization

**Files:**
- Create: `src/providers/client.ts`, `tests/helpers/fake-fetch.ts`, `tests/providers/client.test.ts`

**Interfaces:**
- Consumes: `ProviderDef` (Task 3).
- Produces: `type ErrorKind = 'rate_limit'|'auth'|'server'|'timeout'|'bad_request'`, `interface ProviderError { kind; status: number; message: string; retryAfterMs?: number }`, `interface Credentials { key: string; extra: string | null }`, `type FetchFn = typeof fetch`, `normalizeError(status, headers: Headers, bodyText: string): ProviderError`, `callChat(def, creds, body: Record<string, unknown>, opts?: { fetchImpl?: FetchFn; timeoutMs?: number }): Promise<{ ok: true; response: Response } | { ok: false; error: ProviderError }>`; test helpers `fakeFetch(handler)`, `okJson(content?, usage?)`, `sse(chunks: string[])`.

- [ ] **Step 1: Test helpers** — `tests/helpers/fake-fetch.ts`

```ts
export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

export function fakeFetch(handler: Handler) {
  const calls: { url: string; auth: string | null; body: Record<string, unknown> | null }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      auth: new Headers(init.headers).get('authorization'),
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

export const okJson = (content = 'hello', usage: object | null = { prompt_tokens: 5, completion_tokens: 2 }) =>
  Response.json({
    id: 'x',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  });

export const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
```

- [ ] **Step 2: Write failing test** — `tests/providers/client.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { callChat, normalizeError } from '@/providers/client';
import { getProvider } from '@/providers/registry';
import { fakeFetch, okJson } from '../helpers/fake-fetch';

const h = (o: Record<string, string> = {}) => new Headers(o);

describe('normalizeError', () => {
  it('maps 429 with retry-after seconds', () => {
    expect(normalizeError(429, h({ 'retry-after': '12' }), '{"error":{"message":"slow down"}}'))
      .toEqual({ kind: 'rate_limit', status: 429, message: 'slow down', retryAfterMs: 12000 });
  });
  it('maps auth, server, 404 and bad request', () => {
    expect(normalizeError(401, h(), '').kind).toBe('auth');
    expect(normalizeError(403, h(), '').kind).toBe('auth');
    expect(normalizeError(503, h(), '').kind).toBe('server');
    expect(normalizeError(404, h(), '').kind).toBe('server');
    expect(normalizeError(400, h(), '{"error":"bad"}')).toMatchObject({ kind: 'bad_request', message: 'bad' });
  });
  it('survives non-JSON (HTML) bodies', () => {
    const e = normalizeError(502, h(), '<html>Bad Gateway</html>');
    expect(e.kind).toBe('server');
    expect(e.message).toContain('Bad Gateway');
  });
  it('reads Gemini-style array errors', () => {
    expect(normalizeError(429, h(), '[{"error":{"message":"quota"}}]').message).toBe('quota');
  });
});

describe('callChat', () => {
  it('posts to the provider chat endpoint with a bearer key', async () => {
    const f = fakeFetch(() => okJson());
    const r = await callChat(getProvider('groq')!, { key: 'gsk_1', extra: null }, { model: 'm', messages: [] }, { fetchImpl: f.fn });
    expect(r.ok).toBe(true);
    expect(f.calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(f.calls[0].auth).toBe('Bearer gsk_1');
  });
  it('uses the Cloudflare account id', async () => {
    const f = fakeFetch(() => okJson());
    await callChat(getProvider('cloudflare')!, { key: 't', extra: 'acc' }, {}, { fetchImpl: f.fn });
    expect(f.calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions');
  });
  it('returns normalized errors and treats network failures as timeout', async () => {
    const r1 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, {
      fetchImpl: fakeFetch(() => new Response('nope', { status: 401 })).fn,
    });
    expect(r1).toMatchObject({ ok: false, error: { kind: 'auth' } });
    const r2 = await callChat(getProvider('groq')!, { key: 'k', extra: null }, {}, {
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
    });
    expect(r2).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });
});
```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL.

- [ ] **Step 4: Implement** — `src/providers/client.ts`

```ts
import type { ProviderDef } from './registry';

export type ErrorKind = 'rate_limit' | 'auth' | 'server' | 'timeout' | 'bad_request';

export interface ProviderError {
  kind: ErrorKind;
  status: number;
  message: string;
  retryAfterMs?: number;
}

export interface Credentials {
  key: string;
  extra: string | null;
}

export type FetchFn = typeof fetch;

export type CallResult = { ok: true; response: Response } | { ok: false; error: ProviderError };

function extractMessage(text: string): string | undefined {
  try {
    const j = JSON.parse(text);
    const err = Array.isArray(j) ? j[0]?.error : j.error;
    if (typeof err === 'string') return err;
    return err?.message ?? j.message;
  } catch {
    return text ? text.slice(0, 200) : undefined;
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function normalizeError(status: number, headers: Headers, bodyText: string): ProviderError {
  const message = extractMessage(bodyText) ?? `HTTP ${status}`;
  if (status === 429) {
    return { kind: 'rate_limit', status, message, retryAfterMs: parseRetryAfter(headers.get('retry-after')) };
  }
  if (status === 401 || status === 403) return { kind: 'auth', status, message };
  // 404 usually means the model was retired by the provider: try another candidate.
  if (status >= 500 || status === 404) return { kind: 'server', status, message };
  return { kind: 'bad_request', status, message };
}

export async function callChat(
  def: ProviderDef,
  creds: Credentials,
  body: Record<string, unknown>,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<CallResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  // Timeout covers time-to-headers only; cleared before the body streams.
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetchImpl(`${def.baseUrl(creds.extra)}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, response: res };
    const text = await res.text().catch(() => '');
    return { ok: false, error: normalizeError(res.status, res.headers, text) };
  } catch (e) {
    return { ok: false, error: { kind: 'timeout', status: 0, message: e instanceof Error ? e.message : 'network error' } };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Run** `npm test` — Expected: pass.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: add OpenAI-compatible provider client with error normalization"`

---

### Task 5: Model catalog + candidate selection

**Files:**
- Create: `src/catalog/seed.ts`, `scripts/seed.ts`, `src/router/select.ts`, `tests/router/select.test.ts`

**Interfaces:**
- Consumes: `models` table (Task 1).
- Produces: `SEED_MODELS: (typeof models.$inferInsert)[]`; `interface CatalogModel { provider; modelId; displayName; tier: string; priority: number; contextWindow: number; supportsTools: boolean; rpd: number|null; tpd: number|null; enabled: boolean }`; `isAuto(ref: string): ref is 'auto-smart'|'auto-fast'`; `parseModelRef(ref): { provider: string; modelId: string } | null`; `usageKey(provider, modelId): string`; `interface SelectInput { requested: string; models: CatalogModel[]; connected: { provider: string; excludedFromAuto: boolean }[]; cooling: Set<string>; usageToday: Map<string, { requests: number; tokens: number }>; promptTokens: number; needsTools: boolean }`; `selectCandidates(input: SelectInput): CatalogModel[]`.

- [ ] **Step 1: Write failing test** — `tests/router/select.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { selectCandidates, parseModelRef, type CatalogModel, type SelectInput } from '@/router/select';

const m = (provider: string, modelId: string, tier: string, priority: number, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  provider, modelId, displayName: modelId, tier, priority, contextWindow: 100_000,
  supportsTools: true, rpd: null, tpd: null, enabled: true, ...extra,
});

const catalog = [
  m('groq', 'llama-70b', 'smart', 1),
  m('gemini', 'flash', 'smart', 2),
  m('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', 'smart', 3, { supportsTools: false }),
  m('groq', 'llama-8b', 'fast', 1),
];

const base = (o: Partial<SelectInput> = {}): SelectInput => ({
  requested: 'auto-smart',
  models: catalog,
  connected: [{ provider: 'groq', excludedFromAuto: false }, { provider: 'gemini', excludedFromAuto: false }, { provider: 'openrouter', excludedFromAuto: false }],
  cooling: new Set(),
  usageToday: new Map(),
  promptTokens: 10,
  needsTools: false,
  ...o,
});

const ids = (r: CatalogModel[]) => r.map((x) => `${x.provider}/${x.modelId}`);

describe('parseModelRef', () => {
  it('splits on the first slash only', () => {
    expect(parseModelRef('openrouter/meta-llama/llama-3.3-70b-instruct:free')).toEqual({
      provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    });
    expect(parseModelRef('noslash')).toBeNull();
    expect(parseModelRef('groq/')).toBeNull();
  });
});

describe('selectCandidates', () => {
  it('orders auto tier by priority', () => {
    expect(ids(selectCandidates(base()))).toEqual(['groq/llama-70b', 'gemini/flash', 'openrouter/meta-llama/llama-3.3-70b-instruct:free']);
  });
  it('only uses connected providers', () => {
    expect(ids(selectCandidates(base({ connected: [{ provider: 'gemini', excludedFromAuto: false }] })))).toEqual(['gemini/flash']);
  });
  it('skips cooling providers and over-limit models', () => {
    const r = selectCandidates(base({
      cooling: new Set(['groq']),
      models: catalog.map((x) => (x.provider === 'gemini' ? { ...x, rpd: 10 } : x)),
      usageToday: new Map([['gemini/flash', { requests: 10, tokens: 0 }]]),
    }));
    expect(ids(r)).toEqual(['openrouter/meta-llama/llama-3.3-70b-instruct:free']);
  });
  it('filters by context window and tool support', () => {
    expect(ids(selectCandidates(base({ needsTools: true })))).toEqual(['groq/llama-70b', 'gemini/flash']);
    expect(selectCandidates(base({ promptTokens: 200_000 }))).toEqual([]);
  });
  it('puts an explicit model first, then same-tier fallbacks', () => {
    expect(ids(selectCandidates(base({ requested: 'gemini/flash' })))).toEqual(['gemini/flash', 'groq/llama-70b', 'openrouter/meta-llama/llama-3.3-70b-instruct:free']);
  });
  it('excludes excluded providers from auto and fallback but allows them explicitly', () => {
    const connected = [{ provider: 'groq', excludedFromAuto: false }, { provider: 'gemini', excludedFromAuto: true }];
    expect(ids(selectCandidates(base({ connected })))).toEqual(['groq/llama-70b']);
    expect(ids(selectCandidates(base({ connected, requested: 'gemini/flash' })))).toEqual(['gemini/flash', 'groq/llama-70b']);
  });
  it('returns nothing for unknown explicit models', () => {
    expect(selectCandidates(base({ requested: 'groq/unknown' }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/router/select.ts`

```ts
export interface CatalogModel {
  provider: string;
  modelId: string;
  displayName: string;
  tier: string;
  priority: number;
  contextWindow: number;
  supportsTools: boolean;
  rpd: number | null;
  tpd: number | null;
  enabled: boolean;
}

export interface SelectInput {
  requested: string;
  models: CatalogModel[];
  connected: { provider: string; excludedFromAuto: boolean }[];
  cooling: Set<string>;
  usageToday: Map<string, { requests: number; tokens: number }>;
  promptTokens: number;
  needsTools: boolean;
}

const AUTO_TIERS = { 'auto-smart': 'smart', 'auto-fast': 'fast' } as const;

export function isAuto(ref: string): ref is keyof typeof AUTO_TIERS {
  return ref in AUTO_TIERS;
}

export function parseModelRef(ref: string): { provider: string; modelId: string } | null {
  const i = ref.indexOf('/');
  if (i <= 0 || i === ref.length - 1) return null;
  return { provider: ref.slice(0, i), modelId: ref.slice(i + 1) };
}

export const usageKey = (provider: string, modelId: string) => `${provider}/${modelId}`;

export function selectCandidates(input: SelectInput): CatalogModel[] {
  const connected = new Map(input.connected.map((c) => [c.provider, c]));

  const overLimit = (m: CatalogModel) => {
    const u = input.usageToday.get(usageKey(m.provider, m.modelId));
    if (!u) return false;
    return (m.rpd != null && u.requests >= m.rpd) || (m.tpd != null && u.tokens >= m.tpd);
  };

  const usable = (m: CatalogModel) =>
    m.enabled &&
    connected.has(m.provider) &&
    !input.cooling.has(m.provider) &&
    m.contextWindow >= input.promptTokens + 1024 &&
    (!input.needsTools || m.supportsTools) &&
    !overLimit(m);

  let tier: string;
  let first: CatalogModel[] = [];
  if (isAuto(input.requested)) {
    tier = AUTO_TIERS[input.requested];
  } else {
    const ref = parseModelRef(input.requested);
    const explicit = ref && input.models.find((x) => x.provider === ref.provider && x.modelId === ref.modelId);
    if (!explicit) return [];
    tier = explicit.tier;
    if (usable(explicit)) first = [explicit];
  }

  const rest = input.models
    .filter((m) => m.tier === tier && !first.includes(m) && usable(m) && !connected.get(m.provider)!.excludedFromAuto)
    .sort((a, b) => a.priority - b.priority);

  return [...first, ...rest];
}
```

- [ ] **Step 4: Seed catalog** — `src/catalog/seed.ts`

Limits are approximate (Oct 2026) and editable later in `/admin` (Plan 2). Before running the seed against a real database, check each `modelId` against the provider's current model list (provider docs, or `GET {baseUrl}/models` with a real key) and fix any that were renamed.

```ts
import type { models } from '@/db/schema';

type NewModel = typeof models.$inferInsert;

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
```

`scripts/seed.ts`:
```ts
import { createDb } from '../src/db';
import { models } from '../src/db/schema';
import { SEED_MODELS } from '../src/catalog/seed';

const db = createDb(process.env.DATABASE_URL!);
// DoNothing keeps admin edits to existing rows.
await db.insert(models).values(SEED_MODELS).onConflictDoNothing();
console.log(`seeded ${SEED_MODELS.length} models`);
process.exit(0);
```

- [ ] **Step 5: Run** `npm test && npm run db:seed` — Expected: tests pass; "seeded 14 models".

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: add model catalog seed and candidate selection"`

---

### Task 6: Key service (save, list, validate, credentials)

**Files:**
- Create: `src/keys/service.ts`, `tests/keys/service.test.ts`

**Interfaces:**
- Consumes: `encrypt/decrypt` (Task 2), `callChat`, `Credentials`, `FetchFn` (Task 4), `ProviderDef` (Task 3).
- Produces:
  - `saveKey(db, userId, provider: string, key: string, extra: string | null, vaultKey?: Buffer): Promise<void>` (upsert, status reset to valid)
  - `listKeys(db, userId): Promise<{ provider: string; last4: string; status: string; excludedFromAuto: boolean }[]>`
  - `removeKey(db, userId, provider): Promise<void>`
  - `setExcluded(db, userId, provider, excluded: boolean): Promise<void>`
  - `markInvalid(db, userId, provider): Promise<void>`
  - `touchKey(db, userId, provider): Promise<void>`
  - `loadCredentials(db, userId, vaultKey?): Promise<Map<string, { creds: Credentials; excludedFromAuto: boolean }>>` (valid keys only)
  - `validateKey(def, creds, fetchImpl?): Promise<{ ok: true; note?: string } | { ok: false; message: string }>`

- [ ] **Step 1: Write failing test** — `tests/keys/service.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import { fakeFetch, okJson } from '../helpers/fake-fetch';
import { providerKeys } from '@/db/schema';
import type { DB } from '@/db';
import { getProvider } from '@/providers/registry';
import { saveKey, listKeys, loadCredentials, markInvalid, removeKey, setExcluded, validateKey } from '@/keys/service';

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  userId = (await createUser(db)).id;
});

describe('key storage', () => {
  it('encrypts at rest and exposes only last4', async () => {
    await saveKey(db, userId, 'groq', 'gsk_abcdefgh1234', null, TEST_VAULT_KEY);
    const [row] = await db.select().from(providerKeys);
    expect(row.encryptedKey).not.toContain('gsk_');
    const list = await listKeys(db, userId);
    expect(list).toEqual([{ provider: 'groq', last4: '1234', status: 'valid', excludedFromAuto: false }]);
    expect(JSON.stringify(list)).not.toContain('gsk_abcdefgh');
  });

  it('upserts, decrypts, and skips invalid keys', async () => {
    await saveKey(db, userId, 'cloudflare', 'old-token-0000', 'acc1', TEST_VAULT_KEY);
    await saveKey(db, userId, 'cloudflare', 'new-token-9999', 'acc2', TEST_VAULT_KEY);
    await saveKey(db, userId, 'groq', 'gsk_zzzzzzzz', null, TEST_VAULT_KEY);
    await markInvalid(db, userId, 'groq');
    const creds = await loadCredentials(db, userId, TEST_VAULT_KEY);
    expect([...creds.keys()]).toEqual(['cloudflare']);
    expect(creds.get('cloudflare')!.creds).toEqual({ key: 'new-token-9999', extra: 'acc2' });
  });

  it('isolates users and supports exclude/remove', async () => {
    const other = (await createUser(db)).id;
    await saveKey(db, other, 'gemini', 'AIza-other-user', null, TEST_VAULT_KEY);
    await saveKey(db, userId, 'gemini', 'AIza-mine-12345', null, TEST_VAULT_KEY);
    await setExcluded(db, userId, 'gemini', true);
    const mine = await loadCredentials(db, userId, TEST_VAULT_KEY);
    expect(mine.get('gemini')).toEqual({ creds: { key: 'AIza-mine-12345', extra: null }, excludedFromAuto: true });
    await removeKey(db, userId, 'gemini');
    expect(await listKeys(db, userId)).toEqual([]);
    expect(await listKeys(db, other)).toHaveLength(1);
  });
});

describe('validateKey', () => {
  const groq = getProvider('groq')!;
  const creds = { key: 'gsk_x', extra: null };
  it('accepts a working key with a 1-token call', async () => {
    const f = fakeFetch(() => okJson());
    expect(await validateKey(groq, creds, f.fn)).toEqual({ ok: true });
    expect(f.calls[0].body).toMatchObject({ model: groq.validateModel, max_tokens: 1 });
  });
  it('accepts a rate-limited key with a note', async () => {
    const r = await validateKey(groq, creds, fakeFetch(() => new Response('{}', { status: 429 })).fn);
    expect(r).toMatchObject({ ok: true, note: expect.stringContaining('rate-limited') });
  });
  it('rejects a key the provider refuses', async () => {
    const r = await validateKey(groq, creds, fakeFetch(() => new Response('{}', { status: 401 })).fn);
    expect(r).toEqual({ ok: false, message: 'The provider rejected this key.' });
  });
  it('reports other failures', async () => {
    const r = await validateKey(groq, creds, fakeFetch(() => new Response('<html>down</html>', { status: 503 })).fn);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('down') });
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/keys/service.ts`

```ts
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { providerKeys } from '@/db/schema';
import { decrypt, encrypt } from '@/lib/vault';
import { callChat, type Credentials, type FetchFn } from '@/providers/client';
import type { ProviderDef } from '@/providers/registry';

const byUserProvider = (userId: string, provider: string) =>
  and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider));

export async function saveKey(db: DB, userId: string, provider: string, key: string, extra: string | null, vaultKey?: Buffer) {
  const values = {
    encryptedKey: encrypt(key, vaultKey),
    encryptedExtra: extra ? encrypt(extra, vaultKey) : null,
    last4: key.slice(-4),
    status: 'valid',
  };
  await db.insert(providerKeys).values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [providerKeys.userId, providerKeys.provider], set: values });
}

export async function listKeys(db: DB, userId: string) {
  return db
    .select({
      provider: providerKeys.provider,
      last4: providerKeys.last4,
      status: providerKeys.status,
      excludedFromAuto: providerKeys.excludedFromAuto,
    })
    .from(providerKeys)
    .where(eq(providerKeys.userId, userId))
    .orderBy(providerKeys.provider);
}

export async function removeKey(db: DB, userId: string, provider: string) {
  await db.delete(providerKeys).where(byUserProvider(userId, provider));
}

export async function setExcluded(db: DB, userId: string, provider: string, excluded: boolean) {
  await db.update(providerKeys).set({ excludedFromAuto: excluded }).where(byUserProvider(userId, provider));
}

export async function markInvalid(db: DB, userId: string, provider: string) {
  await db.update(providerKeys).set({ status: 'invalid' }).where(byUserProvider(userId, provider));
}

export async function touchKey(db: DB, userId: string, provider: string) {
  await db.update(providerKeys).set({ lastUsedAt: new Date() }).where(byUserProvider(userId, provider));
}

/** Decrypted credentials for this user's valid keys. Never pass another user's id. */
export async function loadCredentials(db: DB, userId: string, vaultKey?: Buffer) {
  const rows = await db.select().from(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.status, 'valid')));
  const out = new Map<string, { creds: Credentials; excludedFromAuto: boolean }>();
  for (const r of rows) {
    out.set(r.provider, {
      creds: { key: decrypt(r.encryptedKey, vaultKey), extra: r.encryptedExtra ? decrypt(r.encryptedExtra, vaultKey) : null },
      excludedFromAuto: r.excludedFromAuto,
    });
  }
  return out;
}

export async function validateKey(
  def: ProviderDef,
  creds: Credentials,
  fetchImpl?: FetchFn,
): Promise<{ ok: true; note?: string } | { ok: false; message: string }> {
  const r = await callChat(
    def,
    creds,
    { model: def.validateModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
    { fetchImpl, timeoutMs: 15_000 },
  );
  if (r.ok) {
    await r.response.body?.cancel();
    return { ok: true };
  }
  if (r.error.kind === 'rate_limit') return { ok: true, note: 'Key works but is currently rate-limited.' };
  if (r.error.kind === 'auth') return { ok: false, message: 'The provider rejected this key.' };
  return { ok: false, message: `Could not verify the key: ${r.error.message}` };
}
```

- [ ] **Step 4: Run** `npm test` — Expected: pass.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: add encrypted provider key service with validation"`

---

### Task 7: Usage ledger + stream tap

**Files:**
- Create: `src/usage/ledger.ts`, `src/usage/tap.ts`, `tests/usage/usage.test.ts`

**Interfaces:**
- Consumes: `usageEvents` (Task 1), `usageKey` (Task 5).
- Produces:
  - `recordUsage(db, e: { userId: string; provider: string; modelId: string; source: 'chat'|'api'; promptTokens: number; completionTokens: number; status: 'ok'|'rate_limited'|'error'; latencyMs: number }): Promise<void>`
  - `usageToday(db, userId, now?: Date): Promise<Map<string, { requests: number; tokens: number }>>` (UTC day, status ok only, keyed by `usageKey`)
  - `estimateTokens(value: unknown): number` (`ceil(JSON length / 4)`)
  - `tapSseUsage(body: ReadableStream<Uint8Array>, onDone: (r: { usage: { promptTokens: number; completionTokens: number } | null; completionChars: number; failed: boolean }) => void): ReadableStream<Uint8Array>` — passes bytes through unchanged; `onDone` fires exactly once.

- [ ] **Step 1: Write failing test** — `tests/usage/usage.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { sse } from '../helpers/fake-fetch';
import { recordUsage, usageToday, estimateTokens } from '@/usage/ledger';
import { tapSseUsage } from '@/usage/tap';

const drain = async (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe('ledger', () => {
  it('sums today’s successful usage per model', async () => {
    const db = await createTestDb();
    const { id } = await createUser(db);
    const ev = { userId: id, provider: 'groq', modelId: 'm', source: 'api' as const, promptTokens: 10, completionTokens: 5, latencyMs: 1 };
    await recordUsage(db, { ...ev, status: 'ok' });
    await recordUsage(db, { ...ev, status: 'ok' });
    await recordUsage(db, { ...ev, status: 'rate_limited' });
    expect((await usageToday(db, id)).get('groq/m')).toEqual({ requests: 2, tokens: 30 });
  });
  it('estimates tokens', () => {
    expect(estimateTokens([{ role: 'user', content: 'x'.repeat(400) }])).toBeGreaterThan(100);
  });
});

describe('tapSseUsage', () => {
  it('passes bytes through and reads the usage chunk (incl. Groq x_groq)', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[],"x_groq":{"usage":{"prompt_tokens":7,"completion_tokens":2}}}\n\n',
      'data: [DONE]\n\n',
    ];
    let result: unknown;
    const out = await drain(tapSseUsage(sse(chunks).body!, (r) => { result = r; }));
    expect(out).toBe(chunks.join(''));
    expect(result).toEqual({ usage: { promptTokens: 7, completionTokens: 2 }, completionChars: 5, failed: false });
  });
  it('counts characters when there is no usage chunk, across split lines', async () => {
    let result: { usage: unknown; completionChars: number } | undefined;
    await drain(tapSseUsage(sse(['data: {"choices":[{"delta":{"con', 'tent":"abcd"}}]}\n\n']).body!, (r) => { result = r; }));
    expect(result).toMatchObject({ usage: null, completionChars: 4 });
  });
  it('reports failure when the upstream stream errors', async () => {
    const broken = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error('reset')); } });
    let failed: boolean | undefined;
    await expect(drain(tapSseUsage(broken, (r) => { failed = r.failed; }))).rejects.toThrow();
    expect(failed).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/usage/ledger.ts`:
```ts
import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { usageEvents } from '@/db/schema';
import { usageKey } from '@/router/select';

export interface UsageEvent {
  userId: string;
  provider: string;
  modelId: string;
  source: 'chat' | 'api';
  promptTokens: number;
  completionTokens: number;
  status: 'ok' | 'rate_limited' | 'error';
  latencyMs: number;
}

export async function recordUsage(db: DB, e: UsageEvent) {
  await db.insert(usageEvents).values(e);
}

export async function usageToday(db: DB, userId: string, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await db
    .select({
      provider: usageEvents.provider,
      modelId: usageEvents.modelId,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${usageEvents.promptTokens} + ${usageEvents.completionTokens}), 0)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.status, 'ok'), gte(usageEvents.createdAt, start)))
    .groupBy(usageEvents.provider, usageEvents.modelId);
  return new Map(rows.map((r) => [usageKey(r.provider, r.modelId), { requests: r.requests, tokens: r.tokens }]));
}

export function estimateTokens(value: unknown): number {
  return Math.ceil((JSON.stringify(value ?? '') ?? '').length / 4);
}
```

`src/usage/tap.ts`:
```ts
export interface TapResult {
  usage: { promptTokens: number; completionTokens: number } | null;
  completionChars: number;
  failed: boolean;
}

/** Passes an OpenAI-style SSE stream through unchanged while reading usage/content. */
export function tapSseUsage(body: ReadableStream<Uint8Array>, onDone: (r: TapResult) => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: TapResult['usage'] = null;
  let completionChars = 0;
  let finished = false;

  const finish = (failed: boolean) => {
    if (finished) return;
    finished = true;
    onDone({ usage, completionChars, failed });
  };

  const scan = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const j = JSON.parse(data);
      const u = j.usage ?? j.x_groq?.usage;
      if (u?.prompt_tokens != null) usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens ?? 0 };
      const content = j.choices?.[0]?.delta?.content;
      if (typeof content === 'string') completionChars += content.length;
    } catch {
      // Ignore malformed lines; the client still receives the raw bytes.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer) scan(buffer);
          finish(false);
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(scan);
        controller.enqueue(value);
      } catch (e) {
        finish(true);
        controller.error(e);
      }
    },
    cancel(reason) {
      finish(true);
      return reader.cancel(reason);
    },
  });
}
```

- [ ] **Step 4: Run** `npm test` — Expected: pass.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: add usage ledger and SSE usage tap"`

---

### Task 8: Router executor (`routeChat`)

**Files:**
- Create: `src/server/deps.ts`, `src/router/execute.ts`, `src/router/models.ts`, `tests/router/execute.test.ts`
- Modify: `tests/helpers/fixtures.ts` (add `seedTestModels`)

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces:
  - `interface Deps { db: DB; kv: KV; fetchImpl?: FetchFn; vaultKey?: Buffer; now?: () => number }`, `getDeps(): Deps`
  - `interface ChatInput { userId: string; source: 'chat'|'api'; body: Record<string, unknown> }`
  - `type RouteOutcome = { ok: true; response: Response } | { ok: false; status: number; code: string; message: string }`
  - `routeChat(input: ChatInput, deps: Deps): Promise<RouteOutcome>`
  - `listUserModels(db, userId): Promise<{ id: string; name: string; tier: string }[]>`

- [ ] **Step 1: Fixtures** — append to `tests/helpers/fixtures.ts`

```ts
import type { DB } from '@/db';
import { models } from '@/db/schema';

export async function seedTestModels(db: DB) {
  await db.insert(models).values([
    { provider: 'groq', modelId: 'llama-70b', displayName: 'Llama 70B', tier: 'smart', priority: 1, contextWindow: 100000, supportsTools: true },
    { provider: 'gemini', modelId: 'flash', displayName: 'Flash', tier: 'smart', priority: 2, contextWindow: 100000, supportsTools: true },
    { provider: 'groq', modelId: 'llama-8b', displayName: 'Llama 8B', tier: 'fast', priority: 1, contextWindow: 100000, supportsTools: true },
  ]);
}
```

- [ ] **Step 2: Write failing test** — `tests/router/execute.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from '../helpers/db';
import { fakeFetch, okJson, sse, type Handler } from '../helpers/fake-fetch';
import { TEST_VAULT_KEY, seedTestModels } from '../helpers/fixtures';
import type { DB } from '@/db';
import { providerKeys, usageEvents } from '@/db/schema';
import { createMemoryKV, type KV } from '@/lib/kv';
import { saveKey } from '@/keys/service';
import { routeChat } from '@/router/execute';
import { listUserModels } from '@/router/models';

const GROQ = 'api.groq.com';
const GEMINI = 'generativelanguage.googleapis.com';

let db: DB;
let userId: string;
let kv: KV;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestModels(db);
  userId = (await createUser(db)).id;
  kv = createMemoryKV();
});

const connect = async (provider: string, key: string, uid = userId) => saveKey(db, uid, provider, key, null, TEST_VAULT_KEY);
const run = (handler: Handler, body: Record<string, unknown> = {}, uid = userId) => {
  const f = fakeFetch(handler);
  const p = routeChat(
    { userId: uid, source: 'api', body: { model: 'auto-smart', messages: [{ role: 'user', content: 'hi' }], ...body } },
    { db, kv, fetchImpl: f.fn, vaultKey: TEST_VAULT_KEY },
  );
  return { f, p };
};

describe('routeChat', () => {
  it('uses the top-priority provider, labels the response, records usage', async () => {
    await connect('groq', 'gsk_mine');
    const { f, p } = run(() => okJson('hi there'));
    const out = await p;
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.response.headers.get('x-freetoken-provider')).toBe('groq/llama-70b');
    expect((await out.response.json()).choices[0].message.content).toBe('hi there');
    expect(f.calls[0].body).toMatchObject({ model: 'llama-70b' });
    const [ev] = await db.select().from(usageEvents);
    expect(ev).toMatchObject({ provider: 'groq', status: 'ok', promptTokens: 5, completionTokens: 2 });
  });

  it('falls back on 429, then skips the cooling provider on the next call', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    const handler: Handler = (url) =>
      url.includes(GROQ) ? new Response('{"error":{"message":"limit"}}', { status: 429, headers: { 'retry-after': '120' } }) : okJson();
    const first = run(handler);
    const out = await first.p;
    expect(out.ok && out.response.headers.get('x-freetoken-provider')).toBe('gemini/flash');
    const second = run(handler);
    await second.p;
    expect(second.f.calls.map((c) => c.url).some((u) => u.includes(GROQ))).toBe(false);
  });

  it('falls back past an HTML 502 without crashing', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    const { p } = run((url) => (url.includes(GROQ) ? new Response('<html>502</html>', { status: 502 }) : okJson()));
    const out = await p;
    expect(out.ok && out.response.headers.get('x-freetoken-provider')).toBe('gemini/flash');
  });

  it('marks a rejected key invalid and falls back', async () => {
    await connect('groq', 'gsk_revoked');
    await connect('gemini', 'AIza_mine');
    await run((url) => (url.includes(GROQ) ? new Response('{}', { status: 401 }) : okJson())).p;
    const [row] = await db.select().from(providerKeys).where(eq(providerKeys.provider, 'groq'));
    expect(row.status).toBe('invalid');
  });

  it('returns all_providers_exhausted when everything fails', async () => {
    await connect('groq', 'gsk_mine');
    const out = await run(() => new Response('{}', { status: 429 })).p;
    expect(out).toMatchObject({ ok: false, status: 429, code: 'all_providers_exhausted' });
    expect(!out.ok && out.message).toContain('/connect');
  });

  it('does not fall back on a bad request', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    const { f, p } = run(() => new Response('{"error":{"message":"bad param"}}', { status: 400 }));
    expect(await p).toMatchObject({ ok: false, status: 400, message: 'bad param' });
    expect(f.calls).toHaveLength(1);
  });

  it('explains when no providers are connected', async () => {
    expect(await run(() => okJson()).p).toMatchObject({ ok: false, status: 400, code: 'no_providers' });
  });

  it('rejects unknown models', async () => {
    await connect('groq', 'gsk_mine');
    expect(await run(() => okJson(), { model: 'groq/nope' }).p).toMatchObject({ ok: false, status: 404, code: 'model_not_found' });
  });

  it('never uses another user’s keys', async () => {
    const other = (await createUser(db)).id;
    await connect('gemini', 'AIza_OTHER_USER', other);
    await connect('groq', 'gsk_mine');
    const { f, p } = run(() => new Response('{}', { status: 429 }));
    await p;
    expect(f.calls.length).toBeGreaterThan(0);
    for (const c of f.calls) expect(c.auth).toBe('Bearer gsk_mine');
  });

  it('streams through and records estimated usage when no usage chunk is sent', async () => {
    await connect('groq', 'gsk_mine');
    const chunks = ['data: {"choices":[{"delta":{"content":"abcdefgh"}}]}\n\n', 'data: [DONE]\n\n'];
    const out = await run(() => sse(chunks), { stream: true }).p;
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(await out.response.text()).toBe(chunks.join(''));
    await new Promise((r) => setTimeout(r, 50)); // usage is recorded after the stream ends
    const [ev] = await db.select().from(usageEvents);
    expect(ev).toMatchObject({ status: 'ok', completionTokens: 2 });
  });

  it('lists models for connected providers only', async () => {
    await connect('gemini', 'AIza_mine');
    expect((await listUserModels(db, userId)).map((m) => m.id)).toEqual(['gemini/flash']);
  });
});
```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL.

- [ ] **Step 4: Implement**

`src/server/deps.ts`:
```ts
import { getDb, type DB } from '@/db';
import { getKV, type KV } from '@/lib/kv';
import type { FetchFn } from '@/providers/client';

export interface Deps {
  db: DB;
  kv: KV;
  fetchImpl?: FetchFn;
  vaultKey?: Buffer;
  now?: () => number;
}

export function getDeps(): Deps {
  return { db: getDb(), kv: getKV() };
}
```

`src/router/execute.ts`:
```ts
import { models } from '@/db/schema';
import { loadCredentials, markInvalid, touchKey } from '@/keys/service';
import { callChat } from '@/providers/client';
import { getProvider } from '@/providers/registry';
import type { Deps } from '@/server/deps';
import { estimateTokens, recordUsage, usageToday } from '@/usage/ledger';
import { tapSseUsage } from '@/usage/tap';
import { isAuto, parseModelRef, selectCandidates, type CatalogModel } from './select';

export interface ChatInput {
  userId: string;
  source: 'chat' | 'api';
  body: Record<string, unknown>;
}

export type RouteOutcome =
  | { ok: true; response: Response }
  | { ok: false; status: number; code: string; message: string };

const cooldownKey = (userId: string, provider: string) => `cd:${userId}:${provider}`;
const fail = (status: number, code: string, message: string): RouteOutcome => ({ ok: false, status, code, message });

export async function routeChat(input: ChatInput, deps: Deps): Promise<RouteOutcome> {
  const now = deps.now ?? Date.now;
  const { userId, source, body } = input;
  const requested = typeof body.model === 'string' && body.model ? body.model : 'auto-smart';

  // Only this user's keys: the hard no-pooling rule lives here.
  const creds = await loadCredentials(deps.db, userId, deps.vaultKey);
  if (creds.size === 0) {
    return fail(400, 'no_providers', 'You have no connected providers. Add an API key at /connect.');
  }

  const catalog = (await deps.db.select().from(models)) as CatalogModel[];
  if (!isAuto(requested)) {
    const ref = parseModelRef(requested);
    if (!ref || !catalog.some((m) => m.provider === ref.provider && m.modelId === ref.modelId)) {
      return fail(404, 'model_not_found', `Unknown model "${requested}". Use auto-smart, auto-fast, or a model from /api/v1/models.`);
    }
  }

  const cooling = new Set<string>();
  const resetTimes: number[] = [];
  for (const provider of creds.keys()) {
    const until = await deps.kv.get(cooldownKey(userId, provider));
    if (until) {
      cooling.add(provider);
      resetTimes.push(Number(until));
    }
  }

  const candidates = selectCandidates({
    requested,
    models: catalog,
    connected: [...creds].map(([provider, c]) => ({ provider, excludedFromAuto: c.excludedFromAuto })),
    cooling,
    usageToday: await usageToday(deps.db, userId, new Date(now())),
    promptTokens: estimateTokens(body.messages),
    needsTools: Array.isArray(body.tools) && body.tools.length > 0,
  });

  const stream = body.stream === true;
  const promptEstimate = estimateTokens(body.messages);

  for (const m of candidates) {
    if (cooling.has(m.provider)) continue; // a model of this provider failed earlier in this loop
    const def = getProvider(m.provider);
    const c = creds.get(m.provider);
    if (!def || !c) continue;

    const started = now();
    const usageBase = { userId, provider: m.provider, modelId: m.modelId, source };
    const r = await callChat(def, c.creds, { ...body, model: m.modelId }, { fetchImpl: deps.fetchImpl });

    if (!r.ok) {
      const e = r.error;
      await recordUsage(deps.db, {
        ...usageBase, promptTokens: 0, completionTokens: 0, latencyMs: now() - started,
        status: e.kind === 'rate_limit' ? 'rate_limited' : 'error',
      });
      if (e.kind === 'bad_request') return fail(e.status, 'upstream_bad_request', e.message);
      if (e.kind === 'auth') {
        await markInvalid(deps.db, userId, m.provider);
      } else {
        const ttl = Math.max(1000, e.kind === 'rate_limit' ? (e.retryAfterMs ?? 60_000) : 30_000);
        await deps.kv.set(cooldownKey(userId, m.provider), String(now() + ttl), ttl);
        resetTimes.push(now() + ttl);
      }
      cooling.add(m.provider);
      continue;
    }

    await touchKey(deps.db, userId, m.provider);
    const headers = {
      'content-type': r.response.headers.get('content-type') ?? (stream ? 'text/event-stream' : 'application/json'),
      'x-freetoken-provider': `${m.provider}/${m.modelId}`,
    };

    if (stream && r.response.body) {
      const tapped = tapSseUsage(r.response.body, ({ usage, completionChars, failed }) => {
        recordUsage(deps.db, {
          ...usageBase,
          promptTokens: usage?.promptTokens ?? promptEstimate,
          completionTokens: usage?.completionTokens ?? Math.ceil(completionChars / 4),
          status: failed ? 'error' : 'ok',
          latencyMs: now() - started,
        }).catch((err) => console.error('usage record failed', err));
      });
      return { ok: true, response: new Response(tapped, { status: 200, headers }) };
    }

    const json = await r.response.json();
    await recordUsage(deps.db, {
      ...usageBase,
      promptTokens: json.usage?.prompt_tokens ?? promptEstimate,
      completionTokens: json.usage?.completion_tokens ?? 0,
      status: 'ok',
      latencyMs: now() - started,
    });
    return { ok: true, response: Response.json(json, { headers }) };
  }

  const earliest = resetTimes.length ? Math.min(...resetTimes) : null;
  return fail(
    429,
    'all_providers_exhausted',
    'All your connected providers are out of free quota or unavailable.' +
      (earliest ? ` Earliest retry: ${new Date(earliest).toISOString()}.` : '') +
      ' Connect more providers at /connect to increase your quota.',
  );
}
```

`src/router/models.ts`:
```ts
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { models, providerKeys } from '@/db/schema';
import { getProvider } from '@/providers/registry';

export async function listUserModels(db: DB, userId: string) {
  const keys = await db.select({ provider: providerKeys.provider }).from(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.status, 'valid')));
  const connected = new Set(keys.map((k) => k.provider));
  const rows = await db.select().from(models).where(eq(models.enabled, true));
  return rows
    .filter((r) => connected.has(r.provider))
    .sort((a, b) => a.priority - b.priority || a.id - b.id)
    .map((r) => ({
      id: `${r.provider}/${r.modelId}`,
      name: `${r.displayName} · ${getProvider(r.provider)?.name ?? r.provider}`,
      tier: r.tier,
    }));
}
```

- [ ] **Step 5: Run** `npm test` — Expected: all pass.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: add routeChat with fallback, cooldowns and usage recording"`

---

### Task 9: Auth, layout, login

**Files:**
- Create: `src/auth.ts`, `src/lib/session.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/login/page.tsx`, `src/types/next-auth.d.ts`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`

**Interfaces:**
- Produces: `auth()`, `signIn`, `signOut`, `handlers` from `@/auth`; `requireUserId(): Promise<string>` (redirects to `/login`), `sessionUserId(): Promise<string | null>`.

- [ ] **Step 1: Auth config** — `src/auth.ts`

```ts
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';

export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID ? [Google] : []),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: 'dev',
            name: 'Dev login',
            credentials: { email: {} },
            async authorize(c) {
              const email = String(c?.email ?? '').trim().toLowerCase();
              if (!email.includes('@')) return null;
              const db = getDb();
              const [existing] = await db.select().from(users).where(eq(users.email, email));
              if (existing) return existing;
              const [created] = await db.insert(users).values({ email, name: email.split('@')[0] }).returning();
              return created;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
}));
```

`src/types/next-auth.d.ts`:
```ts
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string; name?: string | null; email?: string | null; image?: string | null };
  }
}
```

`src/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
```

`src/lib/session.ts`:
```ts
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await sessionUserId();
  if (!id) redirect('/login');
  return id;
}
```

- [ ] **Step 2: Layout + landing + login**

`src/app/layout.tsx` (replace generated body; keep generated font imports if present):
```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'FreeToken',
  description: 'Combine your free AI API tiers into one chat and one API.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold">FreeToken</Link>
            {session && (
              <>
                <Link href="/connect">Connect</Link>
                <Link href="/chat">Chat</Link>
                <Link href="/settings">API</Link>
                <form className="ml-auto" action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
                  <button className="text-neutral-500 hover:text-neutral-900">Sign out</button>
                </form>
              </>
            )}
            {!session && <Link href="/login" className="ml-auto">Sign in</Link>}
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
import Link from 'next/link';

export default function Home() {
  return (
    <section className="space-y-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">All your free AI quotas, one place.</h1>
      <p className="max-w-2xl text-lg text-neutral-600">
        Connect your own free API keys from Gemini, Groq, OpenRouter, Mistral, Cerebras, GitHub Models and
        Cloudflare. FreeToken routes every request to whichever of your providers still has free quota, in a
        chat UI or through your own OpenAI-compatible API.
      </p>
      <p className="text-sm text-neutral-500">Your keys are encrypted and only ever used for your own requests.</p>
      <Link href="/connect" className="inline-block rounded-lg bg-neutral-900 px-5 py-3 text-white">Get started</Link>
    </section>
  );
}
```

`src/app/login/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { auth, devLoginEnabled, signIn } from '@/auth';

export default async function LoginPage() {
  if ((await auth())?.user) redirect('/connect');
  const google = Boolean(process.env.AUTH_GOOGLE_ID);
  return (
    <section className="mx-auto max-w-sm space-y-6 py-12">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {google && (
        <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/connect' }); }}>
          <button className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-white">Continue with Google</button>
        </form>
      )}
      {devLoginEnabled && (
        <form
          className="space-y-2 rounded-lg border border-dashed p-4"
          action={async (fd: FormData) => { 'use server'; await signIn('dev', { email: fd.get('email'), redirectTo: '/connect' }); }}
        >
          <p className="text-xs text-neutral-500">Development login (disabled in production)</p>
          <input name="email" type="email" required placeholder="you@example.com" className="w-full rounded border px-3 py-2" />
          <button className="w-full rounded-lg border px-4 py-2">Sign in (dev)</button>
        </form>
      )}
      {!google && !devLoginEnabled && <p className="text-sm text-red-600">No sign-in method is configured.</p>}
    </section>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: build succeeds with no type errors.
Then `npm run dev`, open `http://localhost:3000/login`, sign in with the dev form → lands on `/connect` (404 until Task 10 is fine); nav shows Connect/Chat/API/Sign out.

- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: add Auth.js with Google and dev login"`

---

### Task 10: Keys API + Connect page

**Files:**
- Create: `src/server/keys-handlers.ts`, `src/app/api/keys/route.ts`, `src/app/connect/page.tsx`, `src/app/connect/provider-card.tsx`, `tests/server/keys-handlers.test.ts`

**Interfaces:**
- Consumes: key service (Task 6), registry (Task 3), `Deps` (Task 8), `sessionUserId`/`requireUserId` (Task 9).
- Produces: `handleSaveKey(userId: string, raw: unknown, deps: Deps): Promise<{ status: number; body: unknown }>`; routes `GET/POST/PATCH/DELETE /api/keys`.

- [ ] **Step 1: Write failing test** — `tests/server/keys-handlers.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import { fakeFetch, okJson } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { listKeys } from '@/keys/service';
import { handleSaveKey } from '@/server/keys-handlers';

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  userId = (await createUser(db)).id;
});
const deps = (status = 200) => ({
  db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY,
  fetchImpl: fakeFetch(() => (status === 200 ? okJson() : new Response('{}', { status }))).fn,
});

describe('handleSaveKey', () => {
  it('saves a key that passes the test call', async () => {
    const r = await handleSaveKey(userId, { provider: 'groq', key: 'gsk_12345678' }, deps());
    expect(r).toEqual({ status: 200, body: { ok: true, note: null } });
    expect(await listKeys(db, userId)).toHaveLength(1);
  });
  it('does not save a rejected key', async () => {
    const r = await handleSaveKey(userId, { provider: 'groq', key: 'gsk_12345678' }, deps(401));
    expect(r.status).toBe(400);
    expect(await listKeys(db, userId)).toHaveLength(0);
  });
  it('saves a rate-limited key with a note', async () => {
    const r = await handleSaveKey(userId, { provider: 'groq', key: 'gsk_12345678' }, deps(429));
    expect(r).toMatchObject({ status: 200, body: { ok: true, note: expect.any(String) } });
  });
  it('validates input', async () => {
    expect((await handleSaveKey(userId, { provider: 'nope', key: 'k'.repeat(10) }, deps())).status).toBe(400);
    expect((await handleSaveKey(userId, { provider: 'groq', key: 'short' }, deps())).status).toBe(400);
    expect((await handleSaveKey(userId, null, deps())).status).toBe(400);
    const cf = await handleSaveKey(userId, { provider: 'cloudflare', key: 'cf-token-1234' }, deps());
    expect(cf).toEqual({ status: 400, body: { error: 'Account ID is required.' } });
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement handler** — `src/server/keys-handlers.ts`

```ts
import { z } from 'zod';
import { saveKey, validateKey } from '@/keys/service';
import { getProvider } from '@/providers/registry';
import type { Deps } from './deps';

const saveSchema = z.object({
  provider: z.string(),
  key: z.string().trim().min(8).max(500),
  extra: z.string().trim().max(200).optional(),
});

export async function handleSaveKey(userId: string, raw: unknown, deps: Deps) {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: 'Please paste a valid key.' } };
  const def = getProvider(parsed.data.provider);
  if (!def) return { status: 400, body: { error: 'Unknown provider.' } };
  const extra = parsed.data.extra || null;
  if (def.extraField && !extra) return { status: 400, body: { error: `${def.extraField.label} is required.` } };

  const check = await validateKey(def, { key: parsed.data.key, extra }, deps.fetchImpl);
  if (!check.ok) return { status: 400, body: { error: check.message } };

  await saveKey(deps.db, userId, def.id, parsed.data.key, extra, deps.vaultKey);
  return { status: 200, body: { ok: true, note: check.note ?? null } };
}
```

- [ ] **Step 4: Run** `npm test` — Expected: pass.

- [ ] **Step 5: Route** — `src/app/api/keys/route.ts`

```ts
import { z } from 'zod';
import { getDb } from '@/db';
import { listKeys, removeKey, setExcluded } from '@/keys/service';
import { sessionUserId } from '@/lib/session';
import { handleSaveKey } from '@/server/keys-handlers';
import { getDeps } from '@/server/deps';

const unauthorized = () => Response.json({ error: 'Sign in first.' }, { status: 401 });

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  return Response.json(await listKeys(getDb(), uid));
}

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const r = await handleSaveKey(uid, await req.json().catch(() => null), getDeps());
  return Response.json(r.body, { status: r.status });
}

export async function PATCH(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const p = z.object({ provider: z.string(), excludedFromAuto: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Invalid input.' }, { status: 400 });
  await setExcluded(getDb(), uid, p.data.provider, p.data.excludedFromAuto);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const provider = new URL(req.url).searchParams.get('provider');
  if (!provider) return Response.json({ error: 'provider is required.' }, { status: 400 });
  await removeKey(getDb(), uid, provider);
  return Response.json({ ok: true });
}
```

- [ ] **Step 6: Connect page**

`src/app/connect/page.tsx`:
```tsx
import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { PROVIDERS, toPublicProvider } from '@/providers/registry';
import { ProviderCard } from './provider-card';

export default async function ConnectPage() {
  const uid = await requireUserId();
  const keys = new Map((await listKeys(getDb(), uid)).map((k) => [k.provider, k]));
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connect your providers</h1>
        <p className="text-neutral-600">
          Each provider gives you a free API key. The more you connect, the more free quota you get. Keys are
          encrypted, only used for your requests, and you can remove them at any time.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={toPublicProvider(p)} connected={keys.get(p.id) ?? null} />
        ))}
      </div>
    </section>
  );
}
```

`src/app/connect/provider-card.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicProvider } from '@/providers/registry';

type Connected = { last4: string; status: string; excludedFromAuto: boolean } | null;

export function ProviderCard({ provider, connected }: { provider: PublicProvider; connected: Connected }) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: provider.id, key, extra: extra || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ kind: 'error', text: data.error ?? 'Something went wrong.' });
    setKey('');
    setExtra('');
    setMessage({ kind: 'ok', text: data.note ?? 'Connected.' });
    router.refresh();
  }

  async function remove() {
    await fetch(`/api/keys?provider=${provider.id}`, { method: 'DELETE' });
    router.refresh();
  }

  async function toggleExclude(excludedFromAuto: boolean) {
    await fetch('/api/keys', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: provider.id, excludedFromAuto }),
    });
    router.refresh();
  }

  const badge = !connected
    ? <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">Not connected</span>
    : connected.status === 'valid'
      ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Connected ••••{connected.last4}</span>
      : <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Key rejected, paste a new one</span>;

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{provider.name}</h2>
        {badge}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-600">
        {provider.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium text-blue-700 underline">
        Get your {provider.name} key ↗
      </a>
      {provider.note && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{provider.note}</p>}
      <form onSubmit={save} className="space-y-2">
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={connected ? 'Paste a new key to replace' : 'Paste your API key'}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {provider.extraField && (
          <input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={provider.extraField.label}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        )}
        <button disabled={busy || !key} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {busy ? 'Testing…' : 'Test & save'}
        </button>
      </form>
      {message && <p className={`text-sm ${message.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p>}
      {connected && (
        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={connected.excludedFromAuto} onChange={(e) => toggleExclude(e.target.checked)} />
            Exclude from auto-routing
          </label>
          <button onClick={remove} className="text-red-700 hover:underline">Remove</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verify** `npm test && npm run build` — Expected: pass + build OK. In `npm run dev`, `/connect` shows 7 cards with working links; pasting a garbage key shows "The provider rejected this key."

- [ ] **Step 8: Commit** `git add -A && git commit -m "feat: add connect page and keys API"`

---

### Task 11: Chat API + Chat UI

**Files:**
- Create: `src/server/chat-body.ts`, `src/app/api/chat/route.ts`, `src/app/chat/page.tsx`, `src/app/chat/chat.tsx`, `tests/server/chat-body.test.ts`

**Interfaces:**
- Consumes: `routeChat` (Task 8), `listUserModels` (Task 8), session helpers (Task 9).
- Produces: `validateChatBody(raw: unknown, rawLength: number): { ok: true; body: Record<string, unknown> } | { ok: false; message: string }`; `POST /api/chat` (streams).

- [ ] **Step 1: Write failing test** — `tests/server/chat-body.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { validateChatBody } from '@/server/chat-body';

const msgs = (n: number) => Array.from({ length: n }, () => ({ role: 'user', content: 'x' }));

describe('validateChatBody', () => {
  it('accepts a normal body', () => {
    expect(validateChatBody({ messages: msgs(1) }, 100)).toMatchObject({ ok: true });
  });
  it('rejects oversized, empty, too-many and non-object bodies', () => {
    expect(validateChatBody({ messages: msgs(1) }, 1_000_001)).toMatchObject({ ok: false, message: expect.stringContaining('1 MB') });
    expect(validateChatBody({ messages: [] }, 10)).toMatchObject({ ok: false });
    expect(validateChatBody({ messages: msgs(201) }, 10)).toMatchObject({ ok: false, message: expect.stringContaining('200') });
    expect(validateChatBody('hi', 2)).toMatchObject({ ok: false });
    expect(validateChatBody([], 2)).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/server/chat-body.ts`

```ts
export const MAX_BODY_BYTES = 1_000_000;
export const MAX_MESSAGES = 200;

export function validateChatBody(
  raw: unknown,
  rawLength: number,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  if (rawLength > MAX_BODY_BYTES) return { ok: false, message: 'Request body too large (max 1 MB).' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Body must be a JSON object.' };
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, message: 'messages must be a non-empty array.' };
  }
  if (body.messages.length > MAX_MESSAGES) return { ok: false, message: `Too many messages (max ${MAX_MESSAGES}).` };
  return { ok: true, body };
}
```

- [ ] **Step 4: Run** `npm test` — Expected: pass.

- [ ] **Step 5: Route** — `src/app/api/chat/route.ts`

```ts
import { sessionUserId } from '@/lib/session';
import { routeChat } from '@/router/execute';
import { validateChatBody } from '@/server/chat-body';
import { getDeps } from '@/server/deps';

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const text = await req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: { message: 'Body must be JSON.' } }, { status: 400 });
  }
  const v = validateChatBody(raw, text.length);
  if (!v.ok) return Response.json({ error: { message: v.message } }, { status: 400 });
  const out = await routeChat(
    { userId: uid, source: 'chat', body: { model: v.body.model, messages: v.body.messages, stream: true } },
    getDeps(),
  );
  if (out.ok) return out.response;
  return Response.json({ error: { message: out.message, code: out.code } }, { status: out.status });
}
```

- [ ] **Step 6: Chat page**

`src/app/chat/page.tsx`:
```tsx
import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listUserModels } from '@/router/models';
import { Chat } from './chat';

export default async function ChatPage() {
  const uid = await requireUserId();
  const models = await listUserModels(getDb(), uid);
  if (models.length === 0) {
    return (
      <p>
        Connect at least one provider first. <Link href="/connect" className="text-blue-700 underline">Connect providers</Link>
      </p>
    );
  }
  return <Chat models={models} />;
}
```

`src/app/chat/chat.tsx`:
```tsx
'use client';

import { useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string; provider?: string };

export function Chat({ models }: { models: { id: string; name: string }[] }) {
  const [model, setModel] = useState('auto-smart');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(history: Msg[]) {
    setBusy(true);
    setError(null);
    setMsgs([...history, { role: 'assistant', content: '' }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `Request failed (${res.status})`);
      }
      const provider = res.headers.get('x-freetoken-provider') ?? undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (typeof delta === 'string') {
              text += delta;
              setMsgs([...history, { role: 'assistant', content: text, provider }]);
            }
          } catch {
            // ignore keep-alive or malformed lines
          }
        }
      }
    } catch (e) {
      // Mid-stream failures drop the partial answer; the user retries.
      setMsgs(history);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: input.trim() }];
    setInput('');
    void send(history);
  }

  return (
    <section className="flex h-[75vh] flex-col gap-4">
      <select value={model} onChange={(e) => setModel(e.target.value)} className="w-fit rounded border px-2 py-1 text-sm">
        <option value="auto-smart">Auto (smart)</option>
        <option value="auto-fast">Auto (fast)</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <div className="flex-1 space-y-4 overflow-y-auto rounded-xl border bg-white p-4">
        {msgs.length === 0 && <p className="text-sm text-neutral-500">Ask anything. Requests go to whichever of your providers has free quota.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left ${m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}>
              {m.content || (busy && i === msgs.length - 1 ? '…' : '')}
            </div>
            {m.provider && <div className="mt-1 text-xs text-neutral-400">via {m.provider}</div>}
          </div>
        ))}
      </div>
      {error && (
        <div className="flex items-center justify-between rounded bg-red-50 p-3 text-sm text-red-800">
          <span>{error}</span>
          <button onClick={() => send(msgs)} className="font-medium underline">Retry</button>
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message" className="flex-1 rounded-lg border px-3 py-2" />
        <button disabled={busy || !input.trim()} className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-40">Send</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 7: Verify** `npm test && npm run build` — Expected: pass + build OK.

- [ ] **Step 8: Commit** `git add -A && git commit -m "feat: add streaming chat API and chat UI"`

---

### Task 12: API tokens + OpenAI-compatible endpoint

**Files:**
- Create: `src/server/tokens.ts`, `src/server/v1.ts`, `src/app/api/tokens/route.ts`, `src/app/api/v1/chat/completions/route.ts`, `src/app/api/v1/models/route.ts`, `src/app/settings/page.tsx`, `src/app/settings/tokens.tsx`, `tests/server/v1.test.ts`

**Interfaces:**
- Consumes: `generateApiToken/hashApiToken` (Task 2), `routeChat`, `listUserModels` (Task 8), `validateChatBody` (Task 11).
- Produces: `createToken(db, userId, name): Promise<string>` (raw, shown once), `listTokens(db, userId)`, `revokeToken(db, userId, id: number)`, `userIdFromBearer(db, header: string | null): Promise<string | null>`, `handleCompletions(req: Request, deps: Deps): Promise<Response>`, `handleModels(req: Request, deps: Deps): Promise<Response>`.

- [ ] **Step 1: Write failing test** — `tests/server/v1.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY, seedTestModels } from '../helpers/fixtures';
import { fakeFetch, okJson } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { saveKey } from '@/keys/service';
import { createToken, listTokens, revokeToken } from '@/server/tokens';
import { handleCompletions, handleModels } from '@/server/v1';

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  await seedTestModels(db);
  userId = (await createUser(db)).id;
  await saveKey(db, userId, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
});
const deps = () => ({ db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY, fetchImpl: fakeFetch(() => okJson('pong')).fn });
const req = (path: string, token: string | null, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const chat = { model: 'auto-smart', messages: [{ role: 'user', content: 'ping' }] };

describe('/v1/chat/completions', () => {
  it('rejects missing, unknown and revoked tokens with OpenAI-style errors', async () => {
    const none = await handleCompletions(req('/api/v1/chat/completions', null, chat), deps());
    expect(none.status).toBe(401);
    expect((await none.json()).error.code).toBe('invalid_api_key');
    expect((await handleCompletions(req('/api/v1/chat/completions', 'ft_fake', chat), deps())).status).toBe(401);
    const raw = await createToken(db, userId, 'cli');
    const [t] = await listTokens(db, userId);
    await revokeToken(db, userId, t.id);
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, chat), deps())).status).toBe(401);
  });

  it('routes an authenticated request and labels the provider', async () => {
    const raw = await createToken(db, userId, 'cli');
    const res = await handleCompletions(req('/api/v1/chat/completions', raw, chat), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-freetoken-provider')).toBe('groq/llama-70b');
    expect((await res.json()).choices[0].message.content).toBe('pong');
  });

  it('returns 400 for invalid JSON and empty messages', async () => {
    const raw = await createToken(db, userId, 'cli');
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, '{oops'), deps())).status).toBe(400);
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, { messages: [] }), deps())).status).toBe(400);
  });

  it('cannot revoke another user’s token', async () => {
    const other = (await createUser(db)).id;
    const raw = await createToken(db, userId, 'cli');
    const [t] = await listTokens(db, userId);
    await revokeToken(db, other, t.id);
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, chat), deps())).status).toBe(200);
  });
});

describe('/v1/models', () => {
  it('lists auto models plus connected provider models', async () => {
    const raw = await createToken(db, userId, 'cli');
    const body = await (await handleModels(req('/api/v1/models', raw), deps())).json();
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(['auto-smart', 'auto-fast', 'groq/llama-70b', 'groq/llama-8b']);
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/server/tokens.ts`:
```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '@/db';
import { apiTokens } from '@/db/schema';
import { generateApiToken, hashApiToken } from '@/lib/tokens';

export async function createToken(db: DB, userId: string, name: string): Promise<string> {
  const t = generateApiToken();
  await db.insert(apiTokens).values({ userId, name, tokenHash: t.hash, prefix: t.prefix });
  return t.raw;
}

export async function listTokens(db: DB, userId: string) {
  return db
    .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(apiTokens.createdAt);
}

export async function revokeToken(db: DB, userId: string, id: number) {
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)));
}

export async function userIdFromBearer(db: DB, header: string | null): Promise<string | null> {
  const raw = header?.match(/^Bearer\s+(ft_\S+)$/i)?.[1];
  if (!raw) return null;
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashApiToken(raw)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return row.userId;
}
```

`src/server/v1.ts`:
```ts
import { listUserModels } from '@/router/models';
import { routeChat } from '@/router/execute';
import { validateChatBody } from './chat-body';
import type { Deps } from './deps';
import { userIdFromBearer } from './tokens';

export function oaiError(status: number, code: string, message: string) {
  const type = status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : 'invalid_request_error';
  return Response.json({ error: { message, type, code } }, { status });
}

const unauthorized = () => oaiError(401, 'invalid_api_key', 'Missing or invalid FreeToken API token.');

export async function handleCompletions(req: Request, deps: Deps): Promise<Response> {
  const userId = await userIdFromBearer(deps.db, req.headers.get('authorization'));
  if (!userId) return unauthorized();
  const text = await req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return oaiError(400, 'invalid_json', 'Body must be JSON.');
  }
  const v = validateChatBody(raw, text.length);
  if (!v.ok) return oaiError(400, 'invalid_request', v.message);
  const out = await routeChat({ userId, source: 'api', body: v.body }, deps);
  return out.ok ? out.response : oaiError(out.status, out.code, out.message);
}

export async function handleModels(req: Request, deps: Deps): Promise<Response> {
  const userId = await userIdFromBearer(deps.db, req.headers.get('authorization'));
  if (!userId) return unauthorized();
  const ids = ['auto-smart', 'auto-fast', ...(await listUserModels(deps.db, userId)).map((m) => m.id)];
  return Response.json({ object: 'list', data: ids.map((id) => ({ id, object: 'model', owned_by: 'freetoken' })) });
}
```

- [ ] **Step 4: Run** `npm test` — Expected: pass.

- [ ] **Step 5: Routes**

`src/app/api/v1/chat/completions/route.ts`:
```ts
import { getDeps } from '@/server/deps';
import { handleCompletions } from '@/server/v1';

export const POST = (req: Request) => handleCompletions(req, getDeps());
```

`src/app/api/v1/models/route.ts`:
```ts
import { getDeps } from '@/server/deps';
import { handleModels } from '@/server/v1';

export const GET = (req: Request) => handleModels(req, getDeps());
```

`src/app/api/tokens/route.ts`:
```ts
import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { createToken, listTokens, revokeToken } from '@/server/tokens';

const unauthorized = () => Response.json({ error: 'Sign in first.' }, { status: 401 });

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  return Response.json(await listTokens(getDb(), uid));
}

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const p = z.object({ name: z.string().trim().min(1).max(50) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Give the token a name.' }, { status: 400 });
  return Response.json({ token: await createToken(getDb(), uid, p.data.name) });
}

export async function DELETE(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id)) return Response.json({ error: 'id is required.' }, { status: 400 });
  await revokeToken(getDb(), uid, id);
  return Response.json({ ok: true });
}
```

- [ ] **Step 6: Settings page**

`src/app/settings/page.tsx`:
```tsx
import { headers } from 'next/headers';
import { requireUserId } from '@/lib/session';
import { Tokens } from './tokens';

export default async function SettingsPage() {
  await requireUserId();
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const baseUrl = `${proto}://${h.get('host')}/api/v1`;
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your API</h1>
        <p className="text-neutral-600">Use FreeToken from any OpenAI-compatible tool (Cline, Continue, scripts).</p>
      </div>
      <div className="space-y-1 rounded-xl border bg-white p-4 text-sm">
        <div>Base URL: <code className="rounded bg-neutral-100 px-1">{baseUrl}</code></div>
        <div>Models: <code className="rounded bg-neutral-100 px-1">auto-smart</code>, <code className="rounded bg-neutral-100 px-1">auto-fast</code>, or any from <code className="rounded bg-neutral-100 px-1">/models</code></div>
      </div>
      <Tokens />
    </section>
  );
}
```

`src/app/settings/tokens.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

type Token = { id: number; name: string; prefix: string; lastUsedAt: string | null };

export function Tokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);

  const load = async () => setTokens(await (await fetch('/api/tokens')).json());
  useEffect(() => { void load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!res.ok) return;
    setFresh((await res.json()).token);
    setName('');
    void load();
  }

  async function revoke(id: number) {
    await fetch(`/api/tokens?id=${id}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="space-y-4 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">API tokens</h2>
      {fresh && (
        <div className="rounded bg-green-50 p-3 text-sm">
          Copy this token now; it won’t be shown again:
          <code className="mt-1 block break-all rounded bg-white p-2">{fresh}</code>
        </div>
      )}
      <form onSubmit={create} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. laptop" className="flex-1 rounded border px-3 py-2 text-sm" />
        <button disabled={!name.trim()} className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-40">Create</button>
      </form>
      <ul className="divide-y text-sm">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span>{t.name} <code className="text-neutral-500">{t.prefix}…</code></span>
            <button onClick={() => revoke(t.id)} className="text-red-700 hover:underline">Revoke</button>
          </li>
        ))}
        {tokens.length === 0 && <li className="py-2 text-neutral-500">No tokens yet.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Verify** `npm test && npm run build` — Expected: all tests pass, build OK.

- [ ] **Step 8: Commit** `git add -A && git commit -m "feat: add API tokens and OpenAI-compatible v1 endpoints"`

---

### Task 13: Live smoke test with real keys

**Files:** none (verification only)

- [ ] **Step 1:** `npm test && npm run lint && npm run build` — Expected: all green.
- [ ] **Step 2:** `npm run db:migrate && npm run db:seed && npm run dev`.
- [ ] **Step 3:** Ask the user for at least a Groq and a Gemini key (they paste them into the UI themselves, never into chat). Sign in via dev login, connect both on `/connect` → both show "Connected".
- [ ] **Step 4:** On `/chat`, send "Say hi in five words" with Auto (smart) → streamed answer with "via groq/…" label.
- [ ] **Step 5:** On `/settings`, create a token, then:

```bash
curl -s http://localhost:3000/api/v1/models -H "Authorization: Bearer $FT_TOKEN"
curl -s -i http://localhost:3000/api/v1/chat/completions -H "Authorization: Bearer $FT_TOKEN" -H "content-type: application/json" \
  -d '{"model":"auto-fast","messages":[{"role":"user","content":"ping"}]}'
```
Expected: model list includes connected providers; completion returns 200 with `x-freetoken-provider` header.
- [ ] **Step 6:** Fix any catalog model IDs that 404 (Task 5 seed), re-seed, and commit `fix: update catalog model ids` if changed.
