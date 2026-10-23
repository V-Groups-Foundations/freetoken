import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { existsSync, mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { acquireDirLock } from './lock';
import { runMigrations } from './migrations';
import journal from '../../drizzle/meta/_journal.json';
import { and, eq, or, sql } from 'drizzle-orm';
import { RETIRED_MODELS, SEED_MODELS } from '../catalog/seed';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

// "pglite:" = in-memory, "pglite:<dir>" = on-disk PGlite, anything else = Postgres URL.
export function createDb(url: string): DB {
  if (url.startsWith('pglite:')) {
    const dir = url.slice('pglite:'.length);
    if (dir) {
      mkdirSync(dir, { recursive: true });
      acquireDirLock(dir);
    }
    const pg = dir ? new PGlite(dir) : new PGlite();
    // Timestamps are UTC: the app reads them as UTC, but PGlite's now() otherwise uses the computer's
    // time zone — 9 hours ahead in Japan, so "failed in the last 10 minutes" lasted 9 hours. PGlite
    // runs queries in order, so this applies before anything else.
    void pg.exec("SET TIME ZONE 'UTC'");
    return drizzlePglite(pg, { schema }) as unknown as DB;
  }
  return drizzlePg(new Pool({ connectionString: url, options: '-c timezone=UTC' }), { schema }) as unknown as DB;
}

/**
 * Rows stamped in local time before the database ran in UTC look like they're from the future:
 * move those back (only they can be ahead of now, so this is safe to run every start).
 */
export async function healLocalTimestamps(db: DB, offsetMinutes = -new Date().getTimezoneOffset()) {
  if (offsetMinutes <= 0) return; // west of UTC, local stamps were in the past: nothing looks "recent" by mistake
  const shift = sql.raw(`interval '${Math.round(offsetMinutes)} minutes'`);
  for (const [table, column] of [['usage_events', 'created_at'], ['model_feedback', 'created_at'], ['provider_limits', 'updated_at']] as const) {
    await db.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${sql.identifier(column)} - ${shift}
      where ${sql.identifier(column)} > (now() at time zone 'utc') + interval '1 minute'`);
  }
}

const g = globalThis as unknown as { __ftDb?: DB; __ftMigratedTo?: string };

/**
 * The newest migration and model catalog this code ships with; the running database is brought up to
 * them automatically (new catalog rows are added, existing rows — and your edits to them — are kept).
 */
const LATEST_MIGRATION = `${journal.entries.at(-1)?.tag ?? ''}:${[...SEED_MODELS, ...RETIRED_MODELS].map((m) => `${m.provider}/${m.modelId}`).join(',')}`;

/** Bring the catalog up to date: add new rows, switch off retired ones. */
export async function syncCatalog(db: DB) {
  await db.insert(schema.models).values(SEED_MODELS).onConflictDoNothing();
  if (RETIRED_MODELS.length) {
    await db.update(schema.models).set({ enabled: false })
      .where(or(...RETIRED_MODELS.map((r) => and(eq(schema.models.provider, r.provider), eq(schema.models.modelId, r.modelId)))));
  }
}

export function getDb(): DB {
  const url = process.env.DATABASE_URL;
  if (!g.__ftDb) {
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__ftDb = createDb(url);
  }
  // A running server that picks up new code (a pull, or a dev-server reload) would otherwise query
  // columns its database doesn't have until someone runs db:migrate. Applied once per migration set.
  if (url && g.__ftMigratedTo !== LATEST_MIGRATION && process.env.FREETOKEN_AUTO_MIGRATE !== 'off' && existsSync('drizzle')) {
    g.__ftMigratedTo = LATEST_MIGRATION;
    const db = g.__ftDb;
    runMigrations(db, url).then(() => syncCatalog(db)).then(() => healLocalTimestamps(db)).catch((e) => {
      g.__ftMigratedTo = undefined;
      console.error('FreeToken: applying database migrations failed — run npm run db:migrate', e);
    });
  }
  return g.__ftDb;
}
