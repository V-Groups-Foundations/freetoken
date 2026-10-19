import { describe, it, expect } from 'vitest';
import { fromOpenAI, mapModel, MAX_OUTPUT_TOKENS, streamToAnthropic, toOpenAI } from '@/anthropic/translate';

const sseOf = (chunks: object[]) => new ReadableStream<Uint8Array>({
  start(c) {
    const e = new TextEncoder();
    for (const ch of chunks) c.enqueue(e.encode(`data: ${JSON.stringify(ch)}\n\n`));
    c.enqueue(e.encode('data: [DONE]\n\n'));
    c.close();
  },
});
const events = async (s: ReadableStream<Uint8Array>) =>
  (await new Response(s).text()).split('\n\n').filter(Boolean).map((block) => {
    const [ev, data] = block.split('\n');
    return { event: ev.slice(7), data: JSON.parse(data.slice(6)) };
  });

describe('Anthropic → OpenAI request', () => {
  it('maps system, text, images, tool use/results (results right after the call), tools and choice', () => {
    const body = toOpenAI({
      model: 'claude-sonnet-4-5', max_tokens: 32000, stop_sequences: ['END'],
      system: [{ type: 'text', text: 'Be brief.' }],
      tools: [{ name: 'read', description: 'Read a file', input_schema: { type: 'object' } }, { name: 'web_search', type: 'web_search_20250305' }],
      tool_choice: { type: 'any' },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.ts' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file body' }] }, { type: 'text', text: 'now fix it' }] },
      ],
    }) as any;
    expect(body.model).toBe('auto-smart');
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.stop).toEqual(['END']);
    expect(body.tool_choice).toBe('required');
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'read', description: 'Read a file', parameters: { type: 'object' } } }]);
    expect(body.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
    expect(body.messages[2]).toEqual({ role: 'assistant', content: 'Reading.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read', arguments: '{"path":"a.ts"}' } }] });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'file body' });
  });

  it('maps Claude model names to tiers and passes FreeToken ids through', () => {
    expect(mapModel('claude-haiku-4-5')).toBe('auto-fast');
    expect(mapModel('claude-opus-4-1')).toBe('auto-smart');
    expect(mapModel('groq/openai/gpt-oss-120b')).toBe('groq/openai/gpt-oss-120b');
    expect(mapModel('auto-fast')).toBe('auto-fast');
  });
});

describe('OpenAI → Anthropic response', () => {
  it('turns text and tool calls into content blocks with the right stop reason', () => {
    const m = fromOpenAI({ id: 'chatcmpl-1', choices: [{ message: { content: 'On it', tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{"path":"x"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 4 } }, 'claude-x');
    expect(m.content).toEqual([{ type: 'text', text: 'On it' }, { type: 'tool_use', id: 'c1', name: 'read', input: { path: 'x' } }]);
    expect(m).toMatchObject({ type: 'message', role: 'assistant', model: 'claude-x', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 4 } });
    expect(fromOpenAI({ choices: [{ message: { content: 'cut' }, finish_reason: 'length' }] }, 'm').stop_reason).toBe('max_tokens');
  });

  it('streams text as message_start → text block deltas → message_delta → message_stop', async () => {
    const ev = await events(streamToAnthropic(sseOf([
      { id: 'a', choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
    ]), 'claude-x', 7));
    expect(ev.map((e) => e.event)).toEqual(['message_start', 'ping', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(ev[0].data.message.usage.input_tokens).toBe(7);
    expect(ev.filter((e) => e.event === 'content_block_delta').map((e) => e.data.delta.text).join('')).toBe('Hello');
    expect(ev[6].data.delta.stop_reason).toBe('end_turn');
  });

  it('streams tool calls as tool_use blocks with input_json_delta and stop_reason tool_use', async () => {
    const ev = await events(streamToAnthropic(sseOf([
      { choices: [{ delta: { content: 'Let me read it.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }, finish_reason: 'tool_calls' }] },
    ]), 'm', 1));
    const starts = ev.filter((e) => e.event === 'content_block_start').map((e) => e.data.content_block);
    expect(starts).toEqual([{ type: 'text', text: '' }, { type: 'tool_use', id: 'call_1', name: 'read', input: {} }]);
    const json = ev.filter((e) => e.data.delta?.type === 'input_json_delta').map((e) => e.data.delta.partial_json).join('');
    expect(JSON.parse(json)).toEqual({ path: 'a.ts' });
    expect(ev.find((e) => e.event === 'message_delta')!.data.delta.stop_reason).toBe('tool_use');
    expect(ev.filter((e) => e.event === 'content_block_stop').map((e) => e.data.index)).toEqual([0, 1]);
  });
});
