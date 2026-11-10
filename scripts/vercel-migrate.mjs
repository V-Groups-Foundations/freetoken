// Runs before `next build` on Vercel (package.json "vercel-build"): a production deploy brings the
// database up to the migrations it ships with. Preview deploys (and builds without a database) skip it,
// so a branch preview never changes the production database.
import { spawnSync } from 'node:child_process';

if (process.env.VERCEL_ENV !== 'production' || !process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('pglite:')) {
  console.log(`vercel-migrate: skipped (${process.env.VERCEL_ENV ?? 'not on Vercel'})`);
  process.exit(0);
}
const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/migrate.mts'], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
