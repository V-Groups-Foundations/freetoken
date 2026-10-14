import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, toPublicProvider } from '@/providers/registry';

describe('provider registry', () => {
  it('has the free providers with https key pages', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(
      ['cohere', 'gemini', 'github', 'groq', 'nvidia', 'openrouter', 'sambanova'],
    );
    for (const p of PROVIDERS) expect(p.keyUrl).toMatch(/^https:\/\//);
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
