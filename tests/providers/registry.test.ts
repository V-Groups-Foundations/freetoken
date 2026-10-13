import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, toPublicProvider } from '@/providers/registry';

describe('provider registry', () => {
  it('has the seven launch providers with https key pages', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(
      ['cerebras', 'cloudflare', 'gemini', 'github', 'groq', 'mistral', 'openrouter'],
    );
    for (const p of PROVIDERS) expect(p.keyUrl).toMatch(/^https:\/\//);
  });
  it('builds the Cloudflare base URL from the account id', () => {
    expect(getProvider('cloudflare')!.baseUrl('abc123')).toBe(
      'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1',
    );
  });
  it('public view is serializable', () => {
    const pub = toPublicProvider(getProvider('groq')!);
    expect(JSON.parse(JSON.stringify(pub))).toEqual(pub);
    expect(getProvider('nope')).toBeUndefined();
  });
});
