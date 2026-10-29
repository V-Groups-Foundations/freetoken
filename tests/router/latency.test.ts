import { describe, it, expect } from 'vitest';
import { createMemoryKV } from '@/lib/kv';
import { noteLatency, timeoutFor } from '@/router/latency';

const m = { provider: 'groq', modelId: 'llama-70b' };

describe('latency', () => {
  it('uses the defaults until there are 5 samples', async () => {
    const kv = createMemoryKV();
    for (let i = 0; i < 4; i++) await noteLatency(kv, m, 'headers', 100);
    expect(await timeoutFor(kv, m, 'headers', 30_000)).toBe(30_000);
    expect(await timeoutFor(kv, m, 'first', 75_000)).toBe(75_000);
  });

  it('is 3 x p90, clamped to [min, default]', async () => {
    const kv = createMemoryKV();
    for (let i = 0; i < 5; i++) await noteLatency(kv, m, 'headers', 100);
    expect(await timeoutFor(kv, m, 'headers', 30_000)).toBe(10_000); // floor
    for (let i = 0; i < 5; i++) await noteLatency(kv, m, 'first', 8_000);
    expect(await timeoutFor(kv, m, 'first', 75_000)).toBe(24_000); // 3 x 8s
    for (let i = 0; i < 5; i++) await noteLatency(kv, m, 'headers', 20_000);
    expect(await timeoutFor(kv, m, 'headers', 30_000)).toBe(30_000); // never above the default
  });

  it('keeps only the last 20 samples', async () => {
    const kv = createMemoryKV();
    for (let i = 0; i < 20; i++) await noteLatency(kv, m, 'headers', 9_000);
    for (let i = 0; i < 20; i++) await noteLatency(kv, m, 'headers', 100); // pushes every slow one out
    expect(await timeoutFor(kv, m, 'headers', 30_000)).toBe(10_000);
  });
});
