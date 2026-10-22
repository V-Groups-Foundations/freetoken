// OpenAI Responses API (POST /v1/responses) ⇄ Chat Completions, so clients that only speak Responses —
// the Codex CLI since it dropped wire_api = "chat" — run on FreeToken's free models. Stateless: the
// client sends the whole conversation each turn (Codex does, with store: false).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mergeName, toolCallSlots } from './tool-slots';

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: any; tool_calls?: any[]; tool_call_id?: string };
export type ToolKind = 'function' | 'custom' | 'local_shell';

const textOf = (c: any): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p?.text ?? p?.output_text ?? '')).filter(Boolean).join('\n') : c == null ? '' : JSON.stringify(c);

/** A message's content as chat content: a string, or parts when there are images. */
function contentOf(parts: any): any {
  if (!Array.isArray(parts)) return textOf(parts);
  const out: any[] = [];
  for (const p of parts) {
    if (p?.type === 'input_image' && (typeof p.image_url === 'string' || p.image_url?.url)) out.push({ type: 'image_url', image_url: { url: typeof p.image_url === 'string' ? p.image_url : p.image_url.url } });
    else if (typeof p?.text === 'string') out.push({ type: 'text', text: p.text });
  }
  return out.some((p) => p.type === 'image_url') ? out : out.map((p) => p.text).join('\n\n');
}

/** Translate a Responses request into a chat-completions body, plus how to map tool calls back. */
export function toChat(req: any): { body: Record<string, unknown>; kinds: Map<string, ToolKind> } {
  const messages: ChatMessage[] = [];
  const system: string[] = [];
  if (typeof req.instructions === 'string' && req.instructions.trim()) system.push(req.instructions);
  const items: any[] = typeof req.input === 'string' ? [{ type: 'message', role: 'user', content: req.input }] : Array.isArray(req.input) ? req.input : [];
  const answered = new Set(items.filter((i) => /_output$/.test(i?.type ?? '')).map((i) => i.call_id));
  const pendingCalls: string[] = [];
  const closeCalls = () => { // every tool call needs a result before the conversation moves on
    for (const id of pendingCalls.splice(0)) messages.push({ role: 'tool', tool_call_id: id, content: '(no result)' });
  };
  const addCall = (call: any) => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && !messages.slice(-1).some((m) => m.role === 'tool')) (last.tool_calls ??= []).push(call);
    else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    if (!answered.has(call.id)) pendingCalls.push(call.id);
  };
  for (const it of items) {
    const type = it?.type ?? (it?.role ? 'message' : '');
    if (type === 'message') {
      const role = it.role === 'developer' || it.role === 'system' ? 'system' : it.role === 'assistant' ? 'assistant' : 'user';
      if (role === 'system' && !messages.length) { system.push(textOf(it.content)); continue; }
      closeCalls();
      // instructions that arrive mid-conversation: most chat models take one system message, at the top
      if (role === 'system') messages.push({ role: 'user', content: `[System note] ${textOf(it.content)}` });
      else messages.push({ role, content: role === 'assistant' ? textOf(it.content) : contentOf(it.content) });
    } else if (type === 'function_call') {
      addCall({ id: it.call_id, type: 'function', function: { name: it.name, arguments: typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments ?? {}) } });
    } else if (type === 'custom_tool_call') {
      addCall({ id: it.call_id, type: 'function', function: { name: it.name, arguments: JSON.stringify({ input: it.input ?? '' }) } });
    } else if (type === 'local_shell_call') {
      addCall({ id: it.call_id, type: 'function', function: { name: 'local_shell', arguments: JSON.stringify(it.action ?? {}) } });
    } else if (/_call_output$/.test(type)) {
      const i = pendingCalls.indexOf(it.call_id);
      if (i >= 0) pendingCalls.splice(i, 1);
      messages.push({ role: 'tool', tool_call_id: it.call_id, content: textOf(it.output) || '(empty)' });
    }
    // reasoning items, web_search_call etc. have no chat equivalent: skipped
  }
  closeCalls();
  if (system.length) messages.unshift({ role: 'system', content: system.join('\n\n') });

  const kinds = new Map<string, ToolKind>();
  const tools: any[] = [];
  for (const t of req.tools ?? []) {
    if (t?.type === 'function' && t.name) {
      kinds.set(t.name, 'function');
      tools.push({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? { type: 'object', properties: {} } } });
    } else if (t?.type === 'custom' && t.name) {
      kinds.set(t.name, 'custom');
      tools.push({ type: 'function', function: { name: t.name, description: `${t.description ?? ''}\nPut the tool's whole raw input in "input".`, parameters: { type: 'object', properties: { input: { type: 'string', description: 'The raw input' } }, required: ['input'] } } });
    } else if (t?.type === 'local_shell') {
      kinds.set('local_shell', 'local_shell');
      tools.push({ type: 'function', function: { name: 'local_shell', description: 'Run a shell command.', parameters: { type: 'object', properties: { command: { type: 'array', items: { type: 'string' } }, working_directory: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['command'] } } });
    }
    // web_search, namespaces of extra agent tools, etc.: not offered to chat models
  }

  const body: Record<string, unknown> = { model: req.model || 'auto-smart', messages, stream: req.stream === true };
  if (tools.length) {
    body.tools = tools;
    if (req.tool_choice === 'none' || req.tool_choice === 'required' || req.tool_choice === 'auto') body.tool_choice = req.tool_choice;
    else if (req.tool_choice?.name && kinds.has(req.tool_choice.name)) body.tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
    if (typeof req.parallel_tool_calls === 'boolean') body.parallel_tool_calls = req.parallel_tool_calls;
  }
  if (typeof req.max_output_tokens === 'number') body.max_tokens = req.max_output_tokens;
  if (typeof req.temperature === 'number') body.temperature = req.temperature;
  if (typeof req.top_p === 'number') body.top_p = req.top_p;
  if (body.stream) body.stream_options = { include_usage: true };
  return { body, kinds };
}

const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;

/** A finished tool call as the Responses output item its kind needs. */
function callItem(kinds: Map<string, ToolKind>, call: { id: string; name: string; args: string }) {
  const kind = kinds.get(call.name) ?? 'function';
  if (kind === 'custom') {
    let input = call.args;
    try { const j = JSON.parse(call.args); if (typeof j?.input === 'string') input = j.input; } catch { /* raw */ }
    return { type: 'custom_tool_call', id: rid('ctc'), call_id: call.id, name: call.name, input, status: 'completed' };
  }
  if (kind === 'local_shell') {
    let action: any = {};
    try { action = JSON.parse(call.args || '{}'); } catch { /* empty */ }
    return { type: 'local_shell_call', id: rid('lsc'), call_id: call.id, status: 'completed', action: { type: 'exec', ...action } };
  }
  return { type: 'function_call', id: rid('fc'), call_id: call.id, name: call.name, arguments: call.args || '{}', status: 'completed' };
}

/** Models that think out loud in <think>…</think> blocks: keep that out of the answer. */
function thinkFilter() {
  let inside = false, buf = '';
  return (chunk: string) => {
    buf += chunk;
    let out = '';
    for (;;) {
      if (inside) {
        const end = buf.indexOf('</think>');
        if (end < 0) { buf = buf.slice(-8); return out; }
        buf = buf.slice(end + 8); inside = false;
      } else {
        const start = buf.indexOf('<think>');
        if (start < 0) { const keep = Math.min(buf.length, 6); out += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep); if (!buf.includes('<')) { out += buf; buf = ''; } return out; }
        out += buf.slice(0, start); buf = buf.slice(start + 7); inside = true;
      }
    }
  };
}

const usageOf = (u: any) => (u ? { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, total_tokens: (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0) } : undefined);

/** A whole chat completion as a Responses response object. */
export function fromChat(json: any, model: string, kinds: Map<string, ToolKind>) {
  const msg = json?.choices?.[0]?.message ?? {};
  const output: any[] = [];
  const text = thinkFilter()(String(msg.content ?? '')) ;
  if (text.trim()) output.push({ type: 'message', id: rid('msg'), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
  for (const tc of msg.tool_calls ?? []) output.push(callItem(kinds, { id: tc.id || rid('call'), name: tc.function?.name ?? '', args: tc.function?.arguments ?? '{}' }));
  const cut = json?.choices?.[0]?.finish_reason === 'length';
  return { id: rid('resp'), object: 'response', created_at: Math.floor(Date.now() / 1000), status: cut ? 'incomplete' : 'completed',
    ...(cut ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), model, output, usage: usageOf(json?.usage) };
}

/** Stream a chat-completions SSE body out as Responses API events. */
export function streamToResponses(upstream: ReadableStream<Uint8Array>, model: string, kinds: Map<string, ToolKind>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const id = rid('resp');
  const created_at = Math.floor(Date.now() / 1000);
  let seq = 0;
  const ev = (o: Record<string, unknown>) => enc.encode(`event: ${o.type}\ndata: ${JSON.stringify({ ...o, sequence_number: seq++ })}\n\n`);
  const think = thinkFilter();
  let msgId: string | null = null, text = '', usage: any;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const slot = toolCallSlots();
  let finish: string | null = null;
  // the client went away (Ctrl+C in Codex): stop reading and cancel the provider's stream, which also
  // records the request's usage — instead of reading on, or hanging, with nobody listening
  const reader = upstream.getReader();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason).catch(() => {});
    },
    async start(ctrl) {
      const controller = {
        enqueue(chunk: Uint8Array) { if (cancelled) return; try { ctrl.enqueue(chunk); } catch { cancelled = true; } },
        close() { if (cancelled) return; try { ctrl.close(); } catch { /* already closed */ } },
      };
      controller.enqueue(ev({ type: 'response.created', response: { id, object: 'response', created_at, status: 'in_progress', model, output: [] } }));
      let buffer = '';
      const onText = (delta: string) => {
        const t = think(delta);
        if (!t) return;
        if (!msgId) {
          msgId = rid('msg');
          controller.enqueue(ev({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: msgId, role: 'assistant', status: 'in_progress', content: [] } }));
          controller.enqueue(ev({ type: 'response.content_part.added', item_id: msgId, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }));
        }
        text += t;
        controller.enqueue(ev({ type: 'response.output_text.delta', item_id: msgId, output_index: 0, content_index: 0, delta: t }));
      };
      try {
        for (;;) {
          if (cancelled) { await reader.cancel().catch(() => {}); return; }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let j: any;
            try { j = JSON.parse(data); } catch { continue; }
            // the provider broke off mid-answer: report a failed response, not a completed one
            if (j.error) throw new Error(String(j.error.message ?? j.error));
            if (j.usage) usage = j.usage;
            if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
            const d = j.choices?.[0]?.delta;
            if (!d) continue;
            if (typeof d.content === 'string' && d.content) onText(d.content);
            for (const tc of d.tool_calls ?? []) {
              const i = slot(tc);
              const c = calls.get(i) ?? { id: '', name: '', args: '' };
              if (tc.id) c.id = tc.id;
              if (tc.function?.name) c.name = mergeName(c.name, tc.function.name);
              if (tc.function?.arguments) c.args += tc.function.arguments;
              calls.set(i, c);
            }
          }
        }
        onText(''); // flush a partial tag held back by the think filter
        // a model that ends its turn with nothing at all leaves the user staring at a blank screen
        if (!msgId && !calls.size) onText("(The model ended its turn without a reply. Ask again, or say what you'd like it to do next.)");
        const output: any[] = [];
        if (msgId) {
          const item = { type: 'message', id: msgId, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
          controller.enqueue(ev({ type: 'response.output_text.done', item_id: msgId, output_index: 0, content_index: 0, text }));
          controller.enqueue(ev({ type: 'response.output_item.done', output_index: 0, item }));
          output.push(item);
        }
        for (const c of [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)) {
          const item = callItem(kinds, { ...c, id: c.id || rid('call') });
          controller.enqueue(ev({ type: 'response.output_item.added', output_index: output.length, item: { ...item, status: 'in_progress' } }));
          controller.enqueue(ev({ type: 'response.output_item.done', output_index: output.length, item }));
          output.push(item);
        }
        // cut off at the output limit: incomplete, so the client knows the answer (or a tool call) is partial
        const cut = finish === 'length';
        controller.enqueue(ev({ type: cut ? 'response.incomplete' : 'response.completed', response: { id, object: 'response', created_at, status: cut ? 'incomplete' : 'completed',
          ...(cut ? { incomplete_details: { reason: 'max_output_tokens' } } : {}), model, output, usage: usageOf(usage) } }));
      } catch (e) {
        controller.enqueue(ev({ type: 'response.failed', response: { id, object: 'response', created_at, status: 'failed', model, output: [], error: { code: 'server_error', message: (e as Error).message || 'The model stream broke off.' } } }));
      } finally {
        controller.close();
      }
    },
  });
}

/** An OpenAI-style error body. */
export const responsesError = (status: number, message: string, code = status === 401 ? 'invalid_api_key' : status === 429 ? 'rate_limit_exceeded' : 'server_error') =>
  Response.json({ error: { message, type: status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : 'invalid_request_error', code } }, { status });
