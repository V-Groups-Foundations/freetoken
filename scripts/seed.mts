import { createDb } from '../src/db';
import { models } from '../src/db/schema';
import { SEED_MODELS } from '../src/catalog/seed';

const db = createDb(process.env.DATABASE_URL!);
// DoNothing keeps admin edits to existing rows.
await db.insert(models).values(SEED_MODELS).onConflictDoNothing();
console.log(`seeded ${SEED_MODELS.length} models`);
process.exit(0);
