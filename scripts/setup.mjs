// One-command setup: `npm run setup`
//   1. creates .env.local from .env.example, generating AUTH_SECRET and VAULT_MASTER_KEY
//      (values you already set are never changed — a new VAULT_MASTER_KEY would make saved keys unreadable)
//   2. creates the embedded database and loads the model catalog
// Safe to run again at any time.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATED = {
  VAULT_MASTER_KEY: () => randomBytes(32).toString('base64'),
  AUTH_SECRET: () => randomBytes(32).toString('base64'),
};

/** Fill blank generated values in `env` (text of .env.local), starting from `example` when env is empty. */
export function fillEnv(example, env) {
  let text = env ?? example;
  const filled = [];
  for (const [key, make] of Object.entries(GENERATED)) {
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const m = text.match(re);
    if (m && m[1].trim()) continue; // already set: keep it
    const line = `${key}=${make()}`;
    text = m ? text.replace(re, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
    filled.push(key);
  }
  return { text, filled };
}

function main() {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const envPath = join(root, '.env.local');
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  const had = existsSync(envPath);
  const { text, filled } = fillEnv(example, had ? readFileSync(envPath, 'utf8') : null);
  if (!had || filled.length) writeFileSync(envPath, text);
  console.log(had ? (filled.length ? `✓ .env.local: generated ${filled.join(', ')}` : '✓ .env.local already set up') : '✓ created .env.local with fresh secrets');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const script of ['db:migrate', 'db:seed']) {
    const r = spawnSync(npm, ['run', '--silent', script], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status) { console.error(`✗ npm run ${script} failed`); process.exit(r.status ?? 1); }
  }
  console.log('\n✓ FreeToken is ready.\n\n  npm run dev        → http://localhost:3000  (sign in, then Connect a free key)\n  npm run desktop    → V-Run, the desktop coding app\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
