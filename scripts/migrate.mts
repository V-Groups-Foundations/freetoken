import { createDb } from '../src/db';
import { runMigrations } from '../src/db/migrations';

const url = process.env.DATABASE_URL!;
await runMigrations(createDb(url), url);
console.log('migrations applied');
process.exit(0);
