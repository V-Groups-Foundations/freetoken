import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken } from '@/lib/tokens';
import { createMemoryKV } from '@/lib/kv';

describe('api tokens', () => {
  it('generates ft_ tokens whose hash matches', () => {
    const t = generateApiToken();
    expect(t.raw.startsWith('ft_')).toBe(true);
    expect(t.raw.length).toBeGreaterThan(40);
    expect(t.hash).toBe(hashApiToken(t.raw));
    expect(t.raw.startsWith(t.prefix)).toBe(true);
    expect(generateApiToken().raw).not.toBe(t.raw);
  });
});

describe('memory KV', () => {
  it('expires entries', async () => {
    let now = 1000;
    const kv = createMemoryKV(() => now);
    await kv.set('a', '1', 500);
    expect(await kv.get('a')).toBe('1');
    now = 1500;
    expect(await kv.get('a')).toBeNull();
  });
});
