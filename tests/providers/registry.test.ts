import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, toPublicProvider } from '@/providers/registry';

describe('provider registry', () => {
  it('has the free providers with https key pages', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(
      ['cloudflare', 'cohere', 'gemini', 'github', 'groq', 'kilo', 'llm7', 'nvidia', 'openrouter', 'requesty', 'sambanova', 'zai'],
    );
    for (const p of PROVIDERS) expect(p.keyUrl).toMatch(/^https:\/\//);
  });
  it('Cloudflare needs the account id in its URL; Kilo and LLM7 work without a key', () => {
    expect(getProvider('cloudflare')!.baseUrl('0123456789abcdef0123456789abcdef')).toBe('https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1');
    expect(PROVIDERS.filter((p) => p.keyless).map((p) => p.id)).toEqual(['kilo', 'llm7']);
  });
  it('exposes OpenAI-compatible base URLs', () => {
    expect(getProvider('nvidia')!.baseUrl()).toBe('https://integrate.api.nvidia.com/v1');
    expect(getProvider('sambanova')!.baseUrl()).toBe('https://api.sambanova.ai/v1');
    expect(getProvider('cohere')!.baseUrl()).toBe('https://api.cohere.ai/compatibility/v1');
  });
  it('public view is serializable', () => {
    const pub = toPublicProvider(getProvider('groq')!);
    expect(JSON.parse(JSON.stringify(pub))).toEqual(pub);
    expect(getProvider('nope')).toBeUndefined();
  });
});
