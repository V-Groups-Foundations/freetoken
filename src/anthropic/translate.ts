// Anthropic Messages API ⇄ OpenAI chat completions. Tools built for Claude (Claude Code, the Anthropic
// SDKs) speak /v1/messages; FreeToken routes OpenAI-format requests. This translates requests,
// responses and the server-sent event stream both ways, so those tools run on your free models.

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from clients and providers */
import { toolCallSlots } from '@/openai/tool-slots';

export type AnthropicRequest = {
  model?: string;
  system?: string | { type: string; text?: string }[];
  messages: { role: 'user' | 'assistant'; content: string | any[] }[];
  tools?: { name: string; description?: string; input_schema?: unknown; type?: string }[];
  tool_choice?: { type: 'auto' | 'any' | 'tool' | 'none'; name?: string };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
};

/** Providers on free tiers reject very large output budgets; Claude Code asks for 32k+. */
export const MAX_OUTPUT_TOKENS = 8192;

/** Claude model names map to FreeToken's tiers; FreeToken model ids (auto-*, provider/model) pass through. */
export function mapModel(model: string | undefined): string {
  if (!model) return 'auto-smart';
  if (model.startsWith('auto-') || model.includes('/')) return model;
  // whole words: "gemini-2.5-pro" contains "mini" but is not a small model
  return /haiku|fast|\bmini\b|\bnano\b|flash|\blite\b/i.test(model) ? 'auto-fast' : 'auto-smart';
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((b: any) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n')
      : '';

const imagePart = (b: any) => {
  const s = b.source ?? {};
  const url = s.type === 'base64' ? `data:${s.media_type};base64,${s.data}` : s.url;
  return url ? { type: 'image_url', image_url: { url } } : null;
};

/** Anthropic request body → OpenAI chat-completions body. */
export function toOpenAI(req: AnthropicRequest): Record<string, unknown> {
  const messages: any[] = [];
  const system = typeof req.system === 'string' ? req.system : textOf(req.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const m of req.messages ?? []) {
    if (typeof m.content === 'string') { messages.push({ role: m.role, content: m.content }); continue; }
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
      const calls = blocks.filter((b) => b?.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      messages.push({ role: 'assistant', content: text || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // user: tool results become `tool` messages (they must directly follow the assistant's tool calls)
    for (const b of blocks.filter((x) => x?.type === 'tool_result')) {
      const out = textOf(b.content) || (b.is_error ? 'Error' : '(no output)');
      messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${out}` : out });
    }
    const rest = blocks.filter((b) => b?.type === 'text' || b?.type === 'image');
    if (!rest.length) continue;
    if (rest.every((b) => b.type === 'text')) messages.push({ role: 'user', content: rest.map((b) => b.text).join('\n') });
    else messages.push({ role: 'user', content: rest.map((b) => (b.type === 'text' ? { type: 'text', text: b.text } : imagePart(b))).filter(Boolean) });
  }

  const tools = (req.tools ?? []).filter((t) => t.input_schema).map((t) => ({
    type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
  }));
  const tc = req.tool_choice;
  const toolChoice = !tc || !tools.length ? undefined
    : tc.type === 'any' ? 'required' : tc.type === 'none' ? 'none' : tc.type === 'tool' && tc.name ? { type: 'function', function: { name: tc.name } } : 'auto';

  return {
    model: mapModel(req.model),
    messages,
    ...(tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    max_tokens: Math.min(req.max_tokens ?? 4096, MAX_OUTPUT_TOKENS),
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    ...(req.top_p != null ? { top_p: req.top_p } : {}),
    ...(req.stop_sequences?.length ? { stop: req.stop_sequences } : {}),
    stream: !!req.stream,
  };
}

const STOP: Record<string, string> = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'end_turn' };
const parseArgs = (s: string) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const msgId = (id?: string) => `msg_${String(id ?? Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(-24) || Date.now()}`;

/** OpenAI chat completion (non-streamed) → Anthropic message. */
export function fromOpenAI(res: any, model: string) {
  const choice = res?.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  const content: any[] = [];
  if (msg.content) content.push({ type: 'text', text: String(msg.content) });
  for (const c of msg.tool_calls ?? []) content.push({ type: 'tool_use', id: c.id ?? `toolu_${content.length}`, name: c.function?.name ?? '', input: parseArgs(c.function?.arguments ?? '') });
  if (!content.length) content.push({ type: 'text', text: '' });
  return {
    id: msgId(res?.id), type: 'message', role: 'assistant', model, content,
    stop_reason: (msg.tool_calls?.length ? 'tool_use' : STOP[choice.finish_reason] ?? 'end_turn'), stop_sequence: null,
    usage: { input_tokens: res?.usage?.prompt_tokens ?? 0, output_tokens: res?.usage?.completion_tokens ?? 0 },
  };
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...(data as object) })}\n\n`;

/**
 * OpenAI SSE stream → Anthropic SSE stream: message_start, then a text or tool_use content block per
 * piece of output (text_delta / input_json_delta), message_delta with the stop reason, message_stop.
 */
export function streamToAnthropic(upstream: ReadableStream<Uint8Array>, model: string, inputTokens: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = '';
  let started = false;
  let index = -1;
  let open: 'text' | 'tool' | null = null;
  const toolBlock = new Map<number, number>(); // OpenAI tool index → our block index
  const slot = toolCallSlots(); // one slot per real call, however the provider numbers them
  let stop = 'end_turn';
  let outputTokens = 0;
  let realInputTokens: number | null = null; // the provider's own count, when its usage chunk arrives
  let textChars = 0;
  // the client went away (Esc in Claude Code): stop reading and cancel the provider's stream, which
  // also records the request's usage — instead of reading the whole answer with nobody listening
  const reader = upstream.getReader();
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason).catch(() => {});
    },
    async start(raw) {
      const ctrl = {
        enqueue(chunk: Uint8Array) { if (cancelled) return; try { raw.enqueue(chunk); } catch { cancelled = true; } },
        close() { if (cancelled) return; try { raw.close(); } catch { /* already closed */ } },
      };
      const push = (s: string) => ctrl.enqueue(enc.encode(s));
      const begin = (id?: string) => {
        if (started) return;
        started = true;
        push(sse('message_start', { message: { id: msgId(id), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } }));
        push(sse('ping', {}));
      };
      const close = () => { if (open) { push(sse('content_block_stop', { index })); open = null; } };
      const handle = (chunk: any) => {
        // the provider broke off mid-answer ("Upstream idle timeout exceeded"): an error, not a finished turn
        if (chunk?.error) throw new Error(String(chunk.error.message ?? chunk.error));
        begin(chunk?.id);
        if (chunk?.usage) { outputTokens = chunk.usage.completion_tokens ?? outputTokens; realInputTokens = chunk.usage.prompt_tokens ?? realInputTokens; }
        const ch = chunk?.choices?.[0];
        if (!ch) return;
        const d = ch.delta ?? {};
        if (typeof d.content === 'string' && d.content) {
          if (open !== 'text') { close(); index++; open = 'text'; push(sse('content_block_start', { index, content_block: { type: 'text', text: '' } })); }
          textChars += d.content.length;
          push(sse('content_block_delta', { index, delta: { type: 'text_delta', text: d.content } }));
        }
        for (const tc of d.tool_calls ?? []) {
          const i = slot(tc);
          if (!toolBlock.has(i)) {
            close(); index++; open = 'tool'; toolBlock.set(i, index);
            push(sse('content_block_start', { index, content_block: { type: 'tool_use', id: tc.id ?? `toolu_${index}`, name: tc.function?.name ?? '', input: {} } }));
          }
          const args = tc.function?.arguments;
          if (args) push(sse('content_block_delta', { index: toolBlock.get(i), delta: { type: 'input_json_delta', partial_json: args } }));
        }
        if (ch.finish_reason) stop = toolBlock.size ? 'tool_use' : STOP[ch.finish_reason] ?? 'end_turn';
      };
      try {
        for (;;) {
          if (cancelled) { await reader.cancel().catch(() => {}); return; }
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const data = line.startsWith('data:') ? line.slice(5).trim() : '';
            if (!data || data === '[DONE]') continue;
            let chunk: unknown;
            try { chunk = JSON.parse(data); } catch { continue; /* skip a malformed chunk */ }
            handle(chunk);
          }
        }
      } catch (e) {
        begin();
        close();
        push(sse('error', { error: { type: 'api_error', message: e instanceof Error ? e.message : 'stream failed' } }));
        ctrl.close();
        return;
      }
      begin();
      if (index < 0) { index = 0; push(sse('content_block_start', { index, content_block: { type: 'text', text: '' } })); open = 'text'; }
      close();
      push(sse('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: outputTokens || Math.ceil(textChars / 4), ...(realInputTokens != null ? { input_tokens: realInputTokens } : {}) } }));
      push(sse('message_stop', {}));
      ctrl.close();
    },
  });
}

/** Anthropic-style error body. */
export function anthropicError(status: number, message: string) {
  const type = status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : status === 404 ? 'not_found_error' : status >= 500 ? 'api_error' : 'invalid_request_error';
  return Response.json({ type: 'error', error: { type, message } }, { status });
}
