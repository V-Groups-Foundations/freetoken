import { describe, it, expect } from 'vitest';
import { envFor, quoteWinArg, setupText } from '../../src/cli/integrations.mjs';

describe('freetoken run / setup', () => {
  it('points Anthropic and OpenAI clients at FreeToken, blanking a real Anthropic key', () => {
    const e = envFor('http://localhost:3000/api/v1', 'ft_abc');
    expect(e).toMatchObject({ ANTHROPIC_BASE_URL: 'http://localhost:3000/api', ANTHROPIC_AUTH_TOKEN: 'ft_abc', ANTHROPIC_API_KEY: '', OPENAI_BASE_URL: 'http://localhost:3000/api/v1', OPENAI_API_KEY: 'ft_abc' });
  });

  it('quotes Windows arguments so spaces and shell characters survive', () => {
    expect(quoteWinArg('plain')).toBe('plain');
    expect(quoteWinArg('hello world')).toBe('"hello world"');
    expect(quoteWinArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWinArg('a&b')).toBe('"a&b"');
    expect(quoteWinArg('')).toBe('""');
    // cmd.exe would expand %USERNAME% even inside quotes; each % is stepped out of the quotes and caret-escaped
    expect(quoteWinArg('%USERNAME%')).toBe('""^%"USERNAME"^%""');
  });

  it('prints setup with the real base URL, and names the tools it knows', () => {
    const t = setupText('cline', 'http://localhost:3000/api/v1', 'ft_x');
    expect(t).toContain('Base URL: http://localhost:3000/api/v1');
    expect(t).toContain('API Key: ft_x');
    expect(setupText('nope', 'http://localhost:3000/api/v1')).toContain('claude-code');
    expect(setupText('', 'http://localhost:3000/api/v1')).toContain('Claude Code');
  });
});
