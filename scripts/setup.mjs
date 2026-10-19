// One-command setup: `npm run setup` (also run automatically by `npm run dev`)
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

/** Create/complete .env.local, then migrate + seed. Returns false if a step failed. */
export function runSetup({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const envPath = join(root, '.env.local');
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  const had = existsSync(envPath);
  const { text, filled } = fillEnv(example, had ? readFileSync(envPath, 'utf8') : null);
  if (!had || filled.length) writeFileSync(envPath, text);
  log(had ? (filled.length ? `✓ .env.local: generated ${filled.join(', ')}` : '✓ .env.local already set up') : '✓ created .env.local with fresh secrets');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const script of ['db:migrate', 'db:seed']) {
    const r = spawnSync(npm, ['run', '--silent', script], { cwd: root, stdio: quiet ? 'pipe' : 'inherit', shell: process.platform === 'win32', encoding: 'utf8' });
    if (r.status) {
      console.error(`✗ npm run ${script} failed`);
      if (quiet) process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
      return false;
    }
  }
  log('\n✓ FreeToken is ready.\n\n  npm run dev        → opens http://localhost:3000, already signed in\n  npm run desktop    → V-Run, the desktop coding app\n');
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && !runSetup()) process.exit(1);
