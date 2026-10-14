// Assemble an OpenAI-style streaming chat response (content deltas + tool_call deltas + usage)
// into a single message. Pure and testable; the bin wires it to a live SSE reader.

export function parseSseLine(line) {
  if (!line.startsWith('data:')) return null;
  const d = line.slice(5).trim();
  if (!d) return null;
  if (d === '[DONE]') return 'done';
  try { return JSON.parse(d); } catch { return null; }
}

export function newStreamState() {
  return { content: '', toolCalls: [], usage: null };
}

/** Fold one parsed chunk into `state`; returns the content delta (for live printing), if any. */
export function applyChunk(state, chunk) {
  if (chunk?.usage) state.usage = chunk.usage;
  const delta = chunk?.choices?.[0]?.delta;
  if (!delta) return '';
  let out = '';
  if (typeof delta.content === 'string' && delta.content) { state.content += delta.content; out = delta.content; }
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const i = tc.index ?? 0;
      if (!state.toolCalls[i]) state.toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
      const slot = state.toolCalls[i];
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.function.name += tc.function.name;
      if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
    }
  }
  return out;
}

export function finalizeMessage(state) {
  const msg = { role: 'assistant' };
  const calls = state.toolCalls.filter(Boolean);
  if (state.content) msg.content = state.content;
  if (calls.length) msg.tool_calls = calls;
  if (!msg.content && !msg.tool_calls) msg.content = '';
  return msg;
}
