// Launch V-Run (the desktop app in ./desktop). Builds it first when its sources are newer than the
// last build. With --with-server, also runs this FreeToken server (`next dev`) and stops it on exit.
// (V-Run starts the server itself when it's set to use FreeToken; --with-server just shows its logs here.)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const desk = join(root, 'desktop');
const win = process.platform === 'win32';
const npm = (args, cwd, opts = {}) => spawn(win ? 'npm.cmd' : 'npm', args, { cwd, stdio: 'inherit', shell: win, ...opts });

function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

if (!existsSync(join(desk, 'node_modules'))) {
  console.log('Installing V-Run dependencies…');
  if (spawnSync(win ? 'npm.cmd' : 'npm', ['install'], { cwd: desk, stdio: 'inherit', shell: win }).status) process.exit(1);
}
const built = existsSync(join(desk, 'dist/renderer/index.html')) ? statSync(join(desk, 'dist/renderer/index.html')).mtimeMs : 0;
if (!built || newest(join(desk, 'src')) > built) {
  console.log('Building V-Run…');
  if (spawnSync(win ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: desk, stdio: 'inherit', shell: win }).status) process.exit(1);
}

const server = process.argv.includes('--with-server') ? npm(['run', 'dev'], root) : null;
const app = npm(['start'], desk);
const stop = () => {
  if (!server?.pid) return;
  if (win) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
};
app.on('exit', (code) => { stop(); process.exit(code ?? 0); });
process.on('SIGINT', () => { stop(); process.exit(130); });
