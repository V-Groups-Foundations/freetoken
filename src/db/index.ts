import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { acquireDirLock } from './lock';

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

const g = globalThis as unknown as { __ftDb?: DB };

export function getDb(): DB {
  if (!g.__ftDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__ftDb = createDb(url);
  }
  return g.__ftDb;
}
