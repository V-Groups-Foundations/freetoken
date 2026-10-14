import { describe, it, expect } from 'vitest';
import { findFreePort } from '../../src/cli/ports.mjs';

describe('findFreePort', () => {
  it('returns an open port and never 3000', async () => {
    const p = await findFreePort();
    expect(typeof p).toBe('number');
    expect(p).toBeGreaterThan(0);
    expect(p).not.toBe(3000);
  });
  it('ignores 3000 as a preferred port', async () => {
    const p = await findFreePort(3000);
    expect(p).not.toBe(3000);
  });
});
