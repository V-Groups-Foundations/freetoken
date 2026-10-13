import { describe, it, expect } from 'vitest';
import { resolveConfig, deltaFromLine, parseArgs, applyCommand } from '../../src/cli/core.mjs';

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
    expect(parseArgs([])).toEqual({ command: 'chat', model: null, project: null, message: null });
  });
  it('parses login', () => {
    expect(parseArgs(['login'])).toMatchObject({ command: 'login' });
  });
  it('takes a one-shot message and a model flag', () => {
    expect(parseArgs(['--model', 'auto-fast', 'hello', 'there']))
      .toEqual({ command: 'chat', model: 'auto-fast', project: null, message: 'hello there' });
    expect(parseArgs(['-m', 'groq/llama', 'hi'])).toMatchObject({ model: 'groq/llama', message: 'hi' });
  });
  it('takes a project flag', () => {
    expect(parseArgs(['--project', 'abc123', 'hi'])).toMatchObject({ project: 'abc123', message: 'hi' });
    expect(parseArgs(['-p', 'abc123'])).toMatchObject({ project: 'abc123', message: null });
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
