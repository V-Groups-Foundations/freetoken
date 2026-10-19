// `npm run dev`: everything needed to go from a fresh clone to a signed-in browser.
//   1. setup (creates .env.local + the database the first time; quick and safe afterwards)
//   2. a fresh sign-in token in .data/local-login.token (see src/server/local-login.ts)
//   3. `next dev`, and once it answers, opens http://localhost:<port>/welcome?t=<token>
// Flags/env: any `next dev` flags pass through (e.g. --port 4000); --no-open or FREETOKEN_NO_OPEN=1
// skips the browser (V-Run uses that when it starts this server for you).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSetup } from './setup.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const noOpen = args.includes('--no-open') || !!process.env.FREETOKEN_NO_OPEN || !!process.env.CI;
const nextArgs = args.filter((a) => a !== '--no-open');
const portFlag = nextArgs.findIndex((a) => a === '--port' || a === '-p');
const port = Number(portFlag >= 0 ? nextArgs[portFlag + 1] : process.env.PORT) || 3000;

console.log('◆ FreeToken — getting ready…');
if (!runSetup({ quiet: true })) process.exit(1);

const token = randomBytes(32).toString('base64url');
mkdirSync(join(root, '.data'), { recursive: true });
writeFileSync(join(root, '.data', 'local-login.token'), token, { mode: 0o600 });
const link = `http://localhost:${port}/welcome?t=${token}`;

const next = spawn(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', ...nextArgs], { cwd: root, stdio: 'inherit' });
next.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => next.kill(sig));

function openBrowser(url) {
  const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).on('error', () => {}).unref();
}

// wait until the server answers, then hand over the signed-in link
(async () => {
  for (let i = 0; i < 240; i++) {
    try { await fetch(`http://localhost:${port}/login`, { signal: AbortSignal.timeout(20_000) }); break; }
    catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  console.log(`\n  ✓ FreeToken is running.\n  Sign-in link for this computer (no password):\n  ${link}\n`);
  if (!noOpen) openBrowser(link);
})();
