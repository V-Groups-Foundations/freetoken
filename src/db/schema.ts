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

/** A workspace with its own saved conversation, shared by the web chat and the terminal. */
export const projects = pgTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  model: text('model').notNull().default('auto-smart'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('projects_user').on(t.userId, t.updatedAt)]);

/** The shared memory: one row per turn, read and written by both the chat and the terminal. */
export const projectMessages = pgTable('project_messages', {
  id: serial('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant
  content: text('content').notNull(),
  provider: text('provider'), // which provider/model answered (assistant rows)
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('project_messages_project').on(t.projectId, t.id)]);

/** Latest rate-limit numbers a provider reported (via response headers) for this user's key. */
export const providerLimits = pgTable('provider_limits', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  limitRequests: integer('limit_requests'),
  remainingRequests: integer('remaining_requests'),
  requestsResetAt: timestamp('requests_reset_at'),
  limitTokens: integer('limit_tokens'),
  remainingTokens: integer('remaining_tokens'),
  tokensResetAt: timestamp('tokens_reset_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('provider_limits_user_model').on(t.userId, t.provider, t.modelId)]);

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
