/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { fromChat, streamToResponses, toChat } from '@/openai/responses';

const sse = (chunks: object[]) => new ReadableStream<Uint8Array>({
  start(c) {
    const enc = new TextEncoder();
    for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
    c.enqueue(enc.encode('data: [DONE]\n\n'));
    c.close();
  },
});
async function events(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text.split('\n\n').filter(Boolean).map((block) => JSON.parse(block.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

describe('Responses API → chat completions (what the Codex CLI sends)', () => {
  it('developer messages become one system message; tool calls and their outputs pair up', () => {
    const { body, kinds } = toChat({
      model: 'auto-smart', stream: true, tool_choice: 'auto', parallel_tool_calls: true,
      instructions: 'Be brief.',
      tools: [
        { type: 'function', name: 'exec_command', description: 'Run a command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
        { type: 'custom', name: 'apply_patch', description: 'Patch files' },
        { type: 'web_search' }, { type: 'namespace', name: 'multi_agent', tools: [] },
      ],
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex.' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'list files' }, { type: 'input_image', image_url: 'data:image/png;base64,AAA' }] },
        { type: 'reasoning', summary: [] },
        { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{"cmd":"ls"}' },
        { type: 'function_call_output', call_id: 'c1', output: 'a.txt' },
        { type: 'custom_tool_call', call_id: 'c2', name: 'apply_patch', input: '*** Begin Patch' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'thanks' }] },
      ],
    });
    const msgs = body.messages as any[];
    expect(msgs[0]).toEqual({ role: 'system', content: 'Be brief.\n\nYou are Codex.' });
    expect(msgs[1].content).toEqual([{ type: 'text', text: 'list files' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }]);
    expect(msgs[2].tool_calls[0]).toMatchObject({ id: 'c1', function: { name: 'exec_command', arguments: '{"cmd":"ls"}' } });
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'a.txt' });
    expect(msgs[4].tool_calls[0].function).toEqual({ name: 'apply_patch', arguments: JSON.stringify({ input: '*** Begin Patch' }) });
    expect(msgs[5]).toEqual({ role: 'tool', tool_call_id: 'c2', content: '(no result)' }); // unanswered call closed
    expect(msgs[6]).toEqual({ role: 'user', content: 'thanks' });
    expect((body.tools as any[]).map((t) => t.function.name)).toEqual(['exec_command', 'apply_patch']);
    expect(kinds.get('apply_patch')).toBe('custom');
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('streams text and tool calls as Responses events, ending with response.completed and usage', async () => {
    const kinds = new Map([['exec_command', 'function' as const], ['apply_patch', 'custom' as const]]);
    const ev = await events(streamToResponses(sse([
      { choices: [{ delta: { content: '<think>plan</think>Running' } }] },
      { choices: [{ delta: { content: ' it.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'exec_command', arguments: '{"cmd":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }, { index: 1, id: 'call_2', function: { name: 'apply_patch', arguments: '{"input":"*** Begin"}' } }] } }] },
      { choices: [], usage: { prompt_tokens: 50, completion_tokens: 7 } },
    ]), 'auto-smart', kinds));
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe('response.created');
    expect(types.at(-1)).toBe('response.completed');
    const text = ev.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta).join('');
    expect(text).toBe('Running it.'); // <think> kept out
    const done = ev.filter((e) => e.type === 'response.output_item.done').map((e) => e.item);
    expect(done.map((i) => i.type)).toEqual(['message', 'function_call', 'custom_tool_call']);
    expect(done[1]).toMatchObject({ call_id: 'call_1', name: 'exec_command', arguments: '{"cmd":"ls"}' });
    expect(done[2]).toMatchObject({ call_id: 'call_2', name: 'apply_patch', input: '*** Begin' });
    expect(ev.at(-1).response.usage).toEqual({ input_tokens: 50, output_tokens: 7, total_tokens: 57 });
  });

  it('a non-streamed completion becomes a response object', () => {
    const r = fromChat({ choices: [{ message: { content: 'hi', tool_calls: [{ id: 'x', function: { name: 'exec_command', arguments: '{}' } }] } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }, 'auto-fast', new Map());
    expect(r).toMatchObject({ object: 'response', status: 'completed', model: 'auto-fast', usage: { total_tokens: 4 } });
    expect(r.output.map((o: any) => o.type)).toEqual(['message', 'function_call']);
  });
});
