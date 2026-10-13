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
