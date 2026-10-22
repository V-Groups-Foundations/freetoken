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

describe('a provider that breaks off mid-answer', () => {
  const broken = () => {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x', choices: [{ delta: { content: 'half an ans' } }] })}\n\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ error: { message: 'Upstream idle timeout exceeded', code: 502 } })}\n\n`));
        c.close();
      },
    });
  };
  const text = async (s: ReadableStream<Uint8Array>) => new Response(s).text();

  it('Claude Code gets an error event, not a normal end_turn', async () => {
    const out = await text(streamToAnthropic(broken(), 'auto-smart', 10));
    expect(out).toContain('event: error');
    expect(out).toContain('Upstream idle timeout exceeded');
    expect(out).not.toContain('"stop_reason":"end_turn"');
  });

  it('Codex gets response.failed, not a completed response', async () => {
    const out = await text(streamToResponses(broken(), 'auto-smart', new Map()));
    expect(out).toContain('response.failed');
    expect(out).toContain('Upstream idle timeout exceeded');
    expect(out).not.toContain('"status":"completed"');
  });
});

describe("Claude Code's token counts", () => {
  it('the real input token count from the provider is reported at the end', async () => {
    const enc = new TextEncoder();
    const up = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x', choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] })}\n\n`));
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 18234, completion_tokens: 3 } })}\n\n`));
      c.close();
    } });
    const out = await new Response(streamToAnthropic(up, 'auto-smart', 120)).text();
    const delta = out.split('\n').find((l) => l.startsWith('data:') && l.includes('message_delta'))!;
    expect(JSON.parse(delta.slice(5)).usage).toMatchObject({ input_tokens: 18234, output_tokens: 3 });
  });
});
