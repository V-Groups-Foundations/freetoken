import {
  pgTable, text, timestamp, integer, boolean, serial, primaryKey, uniqueIndex, index, real,
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

/** A standalone chat thread (no desktop folder, unlike a project). Each keeps its own memory. */
export const chats = pgTable('chats', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New chat'),
  model: text('model').notNull().default('auto-smart'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('chats_user').on(t.userId, t.updatedAt)]);

/** One row per turn in a chat thread — the chat's persistent memory. */
export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  chatId: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant
  content: text('content').notNull(),
  provider: text('provider'), // which provider/model answered (assistant rows)
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('chat_messages_chat').on(t.chatId, t.id)]);

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

/** A document the user uploaded for retrieval ("chat with your documents"). */
export const documents = pgTable('documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  chars: integer('chars').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  embedProvider: text('embed_provider').notNull(),
  embedModel: text('embed_model').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('documents_user').on(t.userId, t.createdAt)]);

/** One retrievable chunk of a document; its embedding is stored as a JSON number array. */
export const docChunks = pgTable('doc_chunks', {
  id: serial('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: text('embedding').notNull(), // JSON-encoded number[]
}, (t) => [index('doc_chunks_document').on(t.documentId)]);

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
  /** token counts were guessed (the provider didn't report them) */
  estimated: boolean('estimated').notNull().default(false),
  /** what kind of request it was (agent, code, reasoning…): auto routing learns per kind */
  task: text('task'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('usage_user_provider_time').on(t.userId, t.provider, t.createdAt)]);

/** How a model's answer actually worked out, reported by the client (V-Run: a broken tool call, a
 * false claim, a task finished and verified). Auto routing learns from it. */
export const modelFeedback = pgTable('model_feedback', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  task: text('task').notNull(),
  good: boolean('good').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('feedback_user_task_time').on(t.userId, t.task, t.createdAt)]);

/** Pictures made in the Image studio or through /v1/images. The bytes live on disk (src/images/gallery.ts),
 * one JPEG per row, so the database stays small. */
export const generatedImages = pgTable('generated_images', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  kind: text('kind').notNull(), // create | edit | api
  engine: text('engine').notNull(),
  width: integer('width'),
  height: integer('height'),
  bytes: integer('bytes').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('images_user_time').on(t.userId, t.createdAt)]);

/** Diet coach: the user's body numbers and daily targets (one row per user). */
export const dietProfiles = pgTable('diet_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  sex: text('sex'), // male | female
  age: integer('age'),
  heightCm: real('height_cm'),
  goal: text('goal'), // cut | maintain | bulk, or the user's own words
  calories: integer('calories'),
  protein: integer('protein'),
  fat: integer('fat'),
  carbs: integer('carbs'),
  notes: text('notes'), // allergies, dislikes, training days…
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** One food or drink the user had. `day` is the user's own calendar day (YYYY-MM-DD, their time zone). */
export const dietEntries = pgTable('diet_entries', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  meal: text('meal').notNull(), // breakfast | lunch | dinner | snack | drink
  name: text('name').notNull(),
  kcal: real('kcal').notNull(),
  protein: real('protein').notNull().default(0),
  fat: real('fat').notNull().default(0),
  carbs: real('carbs').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('diet_entries_user_day').on(t.userId, t.day)]);

/** A weigh-in: one per user per day (a second one that day replaces it). */
export const dietWeights = pgTable('diet_weights', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  kg: real('kg').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

/** The diet coach conversation (one per user). */
export const dietMessages = pgTable('diet_messages', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant
  content: text('content').notNull(),
  provider: text('provider'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('diet_messages_user').on(t.userId, t.id)]);
