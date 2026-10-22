import { describe, it, expect } from 'vitest';
import { streamToResponses } from '@/openai/responses';
import { streamToAnthropic } from '@/anthropic/translate';

/** A provider stream that keeps producing text chunks until it's cancelled (and counts its reads). */
function endlessUpstream() {
  const state = { pulls: 0, cancelled: false };
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      state.pulls++;
      if (state.pulls > 200) { c.close(); return; } // "the whole answer"
      c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x', choices: [{ delta: { content: `word${state.pulls} ` } }] })}\n\n`));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state };
}

const tick = () => new Promise((r) => setTimeout(r, 50));

describe('a client that disconnects (Esc in Claude Code, Ctrl+C in Codex)', () => {
  for (const [name, make] of [
    ['Responses API (Codex)', (u: ReadableStream<Uint8Array>) => streamToResponses(u, 'auto-smart', new Map())],
    ['Anthropic messages (Claude Code)', (u: ReadableStream<Uint8Array>) => streamToAnthropic(u, 'auto-smart', 10)],
  ] as const) {
    it(`${name}: cancelling stops reading the provider and cancels its stream`, async () => {
      const { stream, state } = endlessUpstream();
      const reader = make(stream).getReader();
      await reader.read();
      await reader.cancel();
      await tick();
      const after = state.pulls;
      await tick();
      expect(state.cancelled).toBe(true);
      expect(state.pulls).toBe(after); // no more reading
      expect(state.pulls).toBeLessThan(200); // the answer wasn't read to the end
    });
  }
});
