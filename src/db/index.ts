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
import { SEED_MODELS } from '../catalog/seed';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

// "pglite:" = in-memory, "pglite:<dir>" = on-disk PGlite, anything else = Postgres URL.
export function createDb(url: string): DB {
  if (url.startsWith('pglite:')) {
    const dir = url.slice('pglite:'.length);
    if (dir) {
      mkdirSync(dir, { recursive: true });
      acquireDirLock(dir);
    }
    return drizzlePglite(dir ? new PGlite(dir) : new PGlite(), { schema }) as unknown as DB;
  }
  return drizzlePg(new Pool({ connectionString: url }), { schema }) as unknown as DB;
}

const g = globalThis as unknown as { __ftDb?: DB; __ftMigratedTo?: string };

/**
 * The newest migration and model catalog this code ships with; the running database is brought up to
 * them automatically (new catalog rows are added, existing rows — and your edits to them — are kept).
 */
const LATEST_MIGRATION = `${journal.entries.at(-1)?.tag ?? ''}:${SEED_MODELS.map((m) => `${m.provider}/${m.modelId}`).join(',').length}`;

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
    runMigrations(db, url).then(() => db.insert(schema.models).values(SEED_MODELS).onConflictDoNothing()).catch((e) => {
      g.__ftMigratedTo = undefined;
      console.error('FreeToken: applying database migrations failed — run npm run db:migrate', e);
    });
  }
  return g.__ftDb;
}
