// Gemini 3 tool calling through the OpenAI-compatible endpoint: every earlier function call in the
// conversation must carry the thought signature Gemini attached to it (extra_content.google.
// thought_signature), or the request is refused with a 400. Clients (V-Run, Claude Code, Codex…) don't
// keep that field, so FreeToken does: signatures are saved as answers pass through, keyed by the tool
// call's id, and put back on the way in. A call with no saved signature (made by another model, or
// older than the cache) gets Google's documented placeholder, which skips the check.

import type { KV } from '@/lib/kv';

export const SIGNATURE_PLACEHOLDER = 'skip_thought_signature_validator';
const SIG_MS = 24 * 60 * 60_000;
const sigKey = (userId: string, callId: string) => `sig:${userId}:${callId}`;

type ToolCall = { id?: string; extra_content?: { google?: { thought_signature?: string } } } & Record<string, unknown>;
type Msg = { role?: string; tool_calls?: ToolCall[] } & Record<string, unknown>;

/** Signatures in a streamed chunk or a whole answer: tool call id → signature. */
export function signaturesIn(choiceParts: { tool_calls?: ToolCall[] } | undefined, into: Map<string, string>) {
  for (const tc of choiceParts?.tool_calls ?? []) {
    const sig = tc?.extra_content?.google?.thought_signature;
    if (tc?.id && typeof sig === 'string' && sig) into.set(tc.id, sig);
  }
  return into;
}

export async function saveSignatures(kv: KV, userId: string, sigs: Map<string, string>) {
  for (const [id, sig] of sigs) await kv.set(sigKey(userId, id), sig, SIG_MS);
}

/**
 * Gemini's stream, made standard: its tool calls come whole, without the `index` OpenAI clients file them
 * under (V-Run dropped them: the model "said" it would run a command, then nothing happened), and its
 * last chunk says finish_reason "stop" even after calling tools. Each call gets its index, and the
 * finish reason becomes "tool_calls".
 */
export function standardizeGeminiStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let calls = 0;
  const fix = (line: string) => {
    if (!line.startsWith('data:')) return line;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return line;
    try {
      const j = JSON.parse(data);
      let changed = false;
      for (const ch of j.choices ?? []) {
        for (const tc of ch?.delta?.tool_calls ?? []) {
          if (typeof tc.index !== 'number') { tc.index = calls; changed = true; }
          calls = Math.max(calls, tc.index + 1);
        }
        if (ch?.finish_reason === 'stop' && calls > 0) { ch.finish_reason = 'tool_calls'; changed = true; }
      }
      return changed ? `data: ${JSON.stringify(j)}` : line;
    } catch {
      return line;
    }
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) controller.enqueue(encoder.encode(fix(buffer)));
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      controller.enqueue(encoder.encode(lines.map(fix).map((l) => `${l}\n`).join('')));
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

/** A whole (not streamed) answer made standard the same way: tool calls → finish_reason "tool_calls". */
export function standardizeGeminiAnswer(json: { choices?: { finish_reason?: string; message?: { tool_calls?: unknown[] } }[] }) {
  for (const ch of json.choices ?? []) if (ch.finish_reason === 'stop' && ch.message?.tool_calls?.length) ch.finish_reason = 'tool_calls';
  return json;
}

/** The messages with a signature on every earlier tool call (saved, else the placeholder). */
export async function withSignatures(kv: KV, userId: string, messages: unknown): Promise<unknown> {
  if (!Array.isArray(messages)) return messages;
  const out: Msg[] = [];
  for (const m of messages as Msg[]) {
    if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) { out.push(m); continue; }
    const calls: ToolCall[] = [];
    for (const tc of m.tool_calls) {
      if (tc?.extra_content?.google?.thought_signature) { calls.push(tc); continue; }
      const saved = tc?.id ? await kv.get(sigKey(userId, tc.id)) : null;
      calls.push({ ...tc, extra_content: { ...tc.extra_content, google: { ...tc.extra_content?.google, thought_signature: saved ?? SIGNATURE_PLACEHOLDER } } });
    }
    out.push({ ...m, tool_calls: calls });
  }
  return out;
}
