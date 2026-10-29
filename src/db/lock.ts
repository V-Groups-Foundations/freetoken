import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The program a process runs (e.g. "node.exe"), or null when it can't be told. */
export function processName(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      return /^"([^"]+)"/.exec(out.trim())?.[1] ?? null;
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5000 }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * PGlite is single-process: two processes opening the same data directory silently
 * lose writes. Claim `<dir>.lock` for this process, refusing if another live process holds it.
 * A lock left by a crash whose process ID now belongs to another program (Windows reuses them
 * quickly) is taken over: only a Node process can be FreeToken.
 */
export function acquireDirLock(dir: string, nameOf: (pid: number) => string | null = processName): void {
  const lockFile = `${dir}.lock`;
  let holder = 0;
  try {
    holder = Number(readFileSync(lockFile, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const name = holder && holder !== process.pid && isAlive(holder) ? nameOf(holder) : undefined;
  if (name !== undefined && (name === null || /node/i.test(name))) {
    throw new Error(
      `PGlite database "${dir}" is already in use by process ${holder} (usually the dev server). ` +
        `Stop it first, or delete ${lockFile} if that process is not FreeToken.`,
    );
  }
  writeFileSync(lockFile, String(process.pid));
}
