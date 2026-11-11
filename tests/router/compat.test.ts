import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_MAX_TOKENS, forProvider } from '@/router/compat';

describe('Cloudflare reply length', () => {
  // Workers AI defaults to 256 tokens: GPT-OSS spent them all thinking and the diet coach answered nothing
  it('gives a request without its own limit a real one', () => {
    const b = forProvider('cloudflare', { model: 'x', messages: [{ role: 'user', content: 'hi' }], stream: true });
    expect(b.max_tokens).toBe(CLOUDFLARE_MAX_TOKENS);
    expect(CLOUDFLARE_MAX_TOKENS).toBeGreaterThanOrEqual(2048);
  });
  it("keeps the caller's own limit", () => {
    expect(forProvider('cloudflare', { messages: [], max_tokens: 1 }).max_tokens).toBe(1);
    expect(forProvider('cloudflare', { messages: [], max_completion_tokens: 900 }).max_tokens).toBe(900);
  });
  it('leaves other providers alone', () => {
    expect(forProvider('groq', { messages: [] }).max_tokens).toBeUndefined();
  });
});
