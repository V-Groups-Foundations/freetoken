import { readFileSync, writeFileSync } from 'node:fs';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * PGlite is single-process: two processes opening the same data directory silently
 * lose writes. Claim `<dir>.lock` for this process, refusing if another live process holds it.
 */
export function acquireDirLock(dir: string): void {
  const lockFile = `${dir}.lock`;
  let holder = 0;
  try {
    holder = Number(readFileSync(lockFile, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (holder && holder !== process.pid && isAlive(holder)) {
    throw new Error(
      `PGlite database "${dir}" is already in use by process ${holder} (usually the dev server). ` +
        `Stop it first, or delete ${lockFile} if that process is not FreeToken.`,
    );
  }
  writeFileSync(lockFile, String(process.pid));
}
