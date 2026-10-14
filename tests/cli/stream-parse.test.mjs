import { describe, it, expect } from 'vitest';
import { parseSseLine, newStreamState, applyChunk, finalizeMessage } from '../../src/cli/stream-parse.mjs';

const chunk = (o) => ({ choices: [{ delta: o }] });

describe('parseSseLine', () => {
  it('parses data lines and [DONE]', () => {
    expect(parseSseLine('data: {"a":1}')).toEqual({ a: 1 });
    expect(parseSseLine('data: [DONE]')).toBe('done');
    expect(parseSseLine(': comment')).toBeNull();
    expect(parseSseLine('data: {bad')).toBeNull();
  });
});

describe('stream assembly', () => {
  it('accumulates content deltas', () => {
    const s = newStreamState();
    expect(applyChunk(s, chunk({ content: 'Hel' }))).toBe('Hel');
    applyChunk(s, chunk({ content: 'lo' }));
    expect(finalizeMessage(s)).toEqual({ role: 'assistant', content: 'Hello' });
  });

  it('assembles streamed tool calls across chunks', () => {
    const s = newStreamState();
    applyChunk(s, chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_', arguments: '{"com' } }] }));
    applyChunk(s, chunk({ tool_calls: [{ index: 0, function: { name: 'command', arguments: 'mand":"ls"}' } }] }));
    const msg = finalizeMessage(s);
    expect(msg.tool_calls[0].id).toBe('c1');
    expect(msg.tool_calls[0].function.name).toBe('run_command');
    expect(msg.tool_calls[0].function.arguments).toBe('{"command":"ls"}');
  });

  it('captures usage from a final chunk', () => {
    const s = newStreamState();
    applyChunk(s, { usage: { total_tokens: 42 }, choices: [] });
    expect(s.usage).toEqual({ total_tokens: 42 });
  });
});
