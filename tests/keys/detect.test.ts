import { describe, it, expect } from 'vitest';
import { detectEnvKeys, detectKeys, maskKey, providerForKey } from '@/keys/detect';

const GEMINI = 'AIzaSyD' + 'x'.repeat(32);
const GROQ = 'gsk_' + 'A1'.repeat(20);
const OR = 'sk-or-v1-' + 'ab12'.repeat(16);
const NV = 'nvapi-' + 'Zz9_'.repeat(10);
const GH = 'github_pat_' + '11AB_'.repeat(10);

describe('detectKeys', () => {
  it('recognises single keys by their shape', () => {
    expect([GEMINI, GROQ, OR, NV, GH].map(providerForKey)).toEqual(['gemini', 'groq', 'openrouter', 'nvidia', 'github']);
    expect(providerForKey('hello-world-123')).toBeNull();
  });

  it('reads a pasted .env file, including names for shapeless keys (Cohere)', () => {
    const r = detectKeys(`# my keys\nexport GROQ_API_KEY="${GROQ}"\nCOHERE_API_KEY=abcdefghijklmnopqrstuvwxyz0123456789ABCD\nGEMINI_API_KEY: '${GEMINI}'\nUNRELATED=1234567890`);
    expect(r.found.map((f) => [f.provider, f.source])).toEqual([['groq', 'GROQ_API_KEY'], ['cohere', 'COHERE_API_KEY'], ['gemini', 'GEMINI_API_KEY']]);
    expect(r.found[1].key).toBe('abcdefghijklmnopqrstuvwxyz0123456789ABCD');
    expect(r.unrecognized).toBe(1);
  });

  it('takes several bare keys at once and keeps the first per provider', () => {
    const r = detectKeys(`${GROQ}, ${OR}\n${NV} gsk_${'B2'.repeat(20)}`);
    expect(r.found.map((f) => f.provider)).toEqual(['groq', 'openrouter', 'nvidia']);
    expect(r.found[0].key).toBe(GROQ);
  });
});

describe('detectEnvKeys', () => {
  it('finds provider keys in environment variables, ignoring non-PAT GitHub tokens', () => {
    const found = detectEnvKeys({ GROQ_API_KEY: GROQ, GOOGLE_API_KEY: GEMINI, GITHUB_TOKEN: 'gho_session_token_xxxxxxxxxxxx', PATH: '/bin' });
    expect(found.map((f) => [f.provider, f.source])).toEqual([['gemini', 'GOOGLE_API_KEY'], ['groq', 'GROQ_API_KEY']]);
  });
  it('masks keys for display', () => expect(maskKey(GROQ)).toBe(`gsk_A1…${GROQ.slice(-4)}`));
});
