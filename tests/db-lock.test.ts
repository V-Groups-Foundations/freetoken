import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireDirLock } from '@/db/lock';

const dir = () => path.join(mkdtempSync(path.join(tmpdir(), 'ft-lock-')), 'pglite');

describe('acquireDirLock', () => {
  it('claims a free directory', () => {
    const d = dir();
    acquireDirLock(d);
    expect(readFileSync(`${d}.lock`, 'utf8')).toBe(String(process.pid));
  });
  it('refuses a directory held by another live process', () => {
    const d = dir();
    writeFileSync(`${d}.lock`, String(process.ppid));
    expect(() => acquireDirLock(d)).toThrow(/already in use by process/);
  });
  it('takes over a stale lock from a dead process', () => {
    const d = dir();
    writeFileSync(`${d}.lock`, '999999');
    acquireDirLock(d);
    expect(readFileSync(`${d}.lock`, 'utf8')).toBe(String(process.pid));
  });
});
