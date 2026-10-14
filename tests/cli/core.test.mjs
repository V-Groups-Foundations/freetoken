import { describe, it, expect } from 'vitest';
import { resolveConfig, deltaFromLine, parseArgs, applyCommand, sanitizeFolderName, renderTranscript, toApiMessages } from '../../src/cli/core.mjs';

describe('resolveConfig', () => {
  it('uses file values, with env overriding them', () => {
    const file = { baseUrl: 'http://localhost:3000/api/v1', token: 'ft_file' };
    expect(resolveConfig(file, {})).toEqual({ baseUrl: 'http://localhost:3000/api/v1', token: 'ft_file' });
    expect(resolveConfig(file, { FREETOKEN_TOKEN: 'ft_env', FREETOKEN_BASE_URL: 'https://x/api/v1' }))
      .toEqual({ baseUrl: 'https://x/api/v1', token: 'ft_env' });
  });
  it('strips a trailing slash from the base URL', () => {
    expect(resolveConfig({ baseUrl: 'https://x/api/v1/', token: 't' }, {}).baseUrl).toBe('https://x/api/v1');
  });
  it('returns nulls when nothing is set', () => {
    expect(resolveConfig(null, {})).toEqual({ baseUrl: null, token: null });
  });
});

describe('deltaFromLine', () => {
  it('extracts assistant content', () => {
    expect(deltaFromLine('data: {"choices":[{"delta":{"content":"Hi"}}]}')).toEqual({ content: 'Hi' });
  });
  it('recognizes the end marker and ignores non-data lines', () => {
    expect(deltaFromLine('data: [DONE]')).toEqual({ done: true });
    expect(deltaFromLine(': keep-alive')).toBeNull();
    expect(deltaFromLine('')).toBeNull();
    expect(deltaFromLine('data: {not json')).toBeNull();
    expect(deltaFromLine('data: {"choices":[{"delta":{}}]}')).toBeNull();
  });
});

describe('parseArgs', () => {
  it('defaults to the chat command', () => {
    expect(parseArgs([])).toEqual({ command: 'chat', model: null, project: null, message: null, auto: false });
  });
  it('parses the --yolo auto-approve flag', () => {
    expect(parseArgs(['--yolo', 'build it'])).toMatchObject({ auto: true, message: 'build it' });
    expect(parseArgs(['hi'])).toMatchObject({ auto: false });
  });
  it('parses login', () => {
    expect(parseArgs(['login'])).toMatchObject({ command: 'login' });
  });
  it('takes a one-shot message and a model flag', () => {
    expect(parseArgs(['--model', 'auto-fast', 'hello', 'there']))
      .toEqual({ command: 'chat', model: 'auto-fast', project: null, message: 'hello there', auto: false });
    expect(parseArgs(['-m', 'groq/llama', 'hi'])).toMatchObject({ model: 'groq/llama', message: 'hi' });
  });
  it('takes a project flag', () => {
    expect(parseArgs(['--project', 'abc123', 'hi'])).toMatchObject({ project: 'abc123', message: 'hi' });
    expect(parseArgs(['-p', 'abc123'])).toMatchObject({ project: 'abc123', message: null });
  });
});

describe('toApiMessages', () => {
  it('strips the internal provider field from user/assistant messages', () => {
    const out = toApiMessages([
      { role: 'user', content: 'hi', provider: null },
      { role: 'assistant', content: 'hello', provider: 'groq/x' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });
  it('keeps tool_calls on assistant and shapes tool messages', () => {
    const out = toApiMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 't1' }], provider: 'x' },
      { role: 'tool', tool_call_id: 't1', content: 'result', foo: 'bar' },
    ]);
    expect(out[0]).toEqual({ role: 'assistant', tool_calls: [{ id: 't1' }] });
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'result' });
  });
  it('strips provider-specific extras (reasoning_content, provider) but keeps nested tool-call data', () => {
    const [out] = toApiMessages([
      { role: 'assistant', content: 'ok', tool_calls: [{ id: 't1', thought_signature: 'sig' }], reasoning_content: 'why', provider: 'nvidia/x' },
    ]);
    expect(out.provider).toBeUndefined();
    expect(out.reasoning_content).toBeUndefined(); // unsupported when echoed back
    expect(out.tool_calls[0].thought_signature).toBe('sig'); // nested data inside tool_calls is preserved
    expect(out).toEqual({ role: 'assistant', content: 'ok', tool_calls: [{ id: 't1', thought_signature: 'sig' }] });
  });
});

describe('sanitizeFolderName', () => {
  it('keeps a clean name', () => {
    expect(sanitizeFolderName('My App')).toBe('My App');
  });
  it('strips characters illegal in folder names', () => {
    expect(sanitizeFolderName('a/b:c*?"<>|d')).toBe('a-b-c------d');
    expect(sanitizeFolderName('  ..trim.. ')).toBe('trim');
  });
  it('falls back when empty', () => {
    expect(sanitizeFolderName('')).toBe('project');
    expect(sanitizeFolderName('///')).toBe('project');
  });
});

describe('renderTranscript', () => {
  it('writes a markdown transcript of the conversation', () => {
    const md = renderTranscript('demo', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', provider: 'groq/x' },
    ]);
    expect(md).toContain('# demo');
    expect(md).toContain('**You:** hi');
    expect(md).toContain('**groq/x:** hello');
  });
  it('handles an empty conversation', () => {
    expect(renderTranscript('demo', [])).toContain('# demo');
  });
});

describe('applyCommand', () => {
  const state = { model: 'auto-smart', messages: [{ role: 'user', content: 'x' }] };
  it('clears history', () => {
    expect(applyCommand('/clear', state)).toEqual({ type: 'clear' });
  });
  it('exits', () => {
    expect(applyCommand('/exit', state)).toEqual({ type: 'exit' });
    expect(applyCommand('/quit', state)).toEqual({ type: 'exit' });
  });
  it('switches model', () => {
    expect(applyCommand('/model auto-fast', state)).toEqual({ type: 'model', model: 'auto-fast' });
    expect(applyCommand('/model', state)).toEqual({ type: 'error', message: 'Usage: /model <id>' });
  });
  it('lists help and models', () => {
    expect(applyCommand('/help', state)).toMatchObject({ type: 'help' });
    expect(applyCommand('/models', state)).toEqual({ type: 'models' });
  });
  it('switches project', () => {
    expect(applyCommand('/project abc', state)).toEqual({ type: 'project', project: 'abc' });
    expect(applyCommand('/project', state)).toEqual({ type: 'project', project: null });
  });
  it('treats unknown slash commands as an error and plain text as a message', () => {
    expect(applyCommand('/nope', state)).toMatchObject({ type: 'error' });
    expect(applyCommand('hello', state)).toEqual({ type: 'message', text: 'hello' });
  });
});
