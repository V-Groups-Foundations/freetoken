import { describe, it, expect, vi } from 'vitest';
import {
  TOOLS, agentSystemPrompt, classifyPermission, isDangerous, parseToolCalls,
  truncate, safeResolve, executeTool, runAgentTurn, computeFileChange,
} from '../../src/cli/agent.mjs';

describe('tool specs', () => {
  it('exposes the full tool set', () => {
    expect(TOOLS.map((t) => t.function.name).sort()).toEqual([
      'edit_file', 'glob', 'grep', 'image_gen', 'list_dir', 'read_file',
      'read_url', 'run_command', 'search_web', 'start_server', 'write_file',
    ]);
  });
  it('puts the cwd + port rules in the system prompt', () => {
    const p = agentSystemPrompt('/tmp/proj');
    expect(p).toContain('/tmp/proj');
    expect(p).toContain('3000');
  });
});

describe('classifyPermission', () => {
  it('auto-runs read-only tools, confirms mutating ones', () => {
    for (const t of ['read_file', 'list_dir', 'grep', 'glob', 'read_url', 'search_web']) {
      expect(classifyPermission(t)).toBe('auto');
    }
    for (const t of ['run_command', 'write_file', 'edit_file', 'image_gen', 'start_server']) {
      expect(classifyPermission(t)).toBe('confirm');
    }
  });
});

describe('isDangerous', () => {
  it('flags destructive commands', () => {
    expect(isDangerous('rm -rf /')).toBe(true);
    expect(isDangerous('sudo rm -rf ~/')).toBe(true);
    expect(isDangerous('git push origin main --force')).toBe(true);
    expect(isDangerous('shutdown now')).toBe(true);
    expect(isDangerous('taskkill /PID 24996 /F')).toBe(true);
    expect(isDangerous('kill -9 1234')).toBe(true);
  });
  it('allows ordinary commands', () => {
    expect(isDangerous('npm install')).toBe(false);
    expect(isDangerous('ls -la')).toBe(false);
    expect(isDangerous('rm build/tmp.txt')).toBe(false);
  });
});

describe('parseToolCalls', () => {
  it('normalizes tool calls and parses JSON args', () => {
    const msg = { tool_calls: [{ id: 'c1', function: { name: 'run_command', arguments: '{"command":"ls"}' } }] };
    expect(parseToolCalls(msg)).toEqual([{ id: 'c1', name: 'run_command', args: { command: 'ls' } }]);
  });
  it('flags un-parseable arguments instead of throwing', () => {
    const msg = { tool_calls: [{ id: 'c2', function: { name: 'write_file', arguments: '{bad json' } }] };
    const [call] = parseToolCalls(msg);
    expect(call.args.__parseError).toBe(true);
  });
  it('returns [] when there are no tool calls', () => {
    expect(parseToolCalls({ content: 'hi' })).toEqual([]);
  });
});

describe('truncate', () => {
  it('caps long output', () => {
    const out = truncate('x'.repeat(100), 10);
    expect(out.startsWith('xxxxxxxxxx')).toBe(true);
    expect(out).toContain('truncated');
  });
});

describe('safeResolve', () => {
  it('resolves paths inside the project', () => {
    expect(safeResolve('/proj', 'a/b.txt')).toBe(safeResolve('/proj', 'a/b.txt'));
  });
  it('rejects paths that escape the project', () => {
    expect(() => safeResolve('/proj', '../secret')).toThrow();
    expect(() => safeResolve('/proj', '/etc/passwd')).toThrow();
  });
});

describe('executeTool', () => {
  const cwd = '/proj';
  it('runs a command via the injected exec', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'hello', stderr: '' });
    const out = await executeTool('run_command', { command: 'echo hello' }, { cwd, exec });
    expect(exec).toHaveBeenCalledWith('echo hello', expect.objectContaining({ cwd }));
    expect(out).toContain('hello');
  });
  it('captures a failing command’s output and exit code', async () => {
    const exec = vi.fn().mockRejectedValue({ stdout: '', stderr: 'boom', code: 2, message: 'Command failed' });
    const out = await executeTool('run_command', { command: 'false' }, { cwd, exec });
    expect(out).toContain('boom');
    expect(out).toContain('exit 2');
  });
  it('reads a file', async () => {
    const readFile = vi.fn().mockResolvedValue('contents');
    const out = await executeTool('read_file', { path: 'a.txt' }, { cwd, readFile });
    expect(out).toBe('contents');
  });
  it('writes a file (creating parent dirs)', async () => {
    const writeFile = vi.fn().mockResolvedValue();
    const mkdir = vi.fn().mockResolvedValue();
    const out = await executeTool('write_file', { path: 'src/a.txt', content: 'hi' }, { cwd, writeFile, mkdir });
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(out).toMatch(/Created src\/a\.txt/);
  });
  it('lists a directory', async () => {
    const readdir = vi.fn().mockResolvedValue([
      { name: 'b', isDirectory: () => true },
      { name: 'a.txt', isDirectory: () => false },
    ]);
    const out = await executeTool('list_dir', { path: '.' }, { cwd, readdir });
    expect(out).toBe('a.txt\nb/');
  });
  it('rejects a path escape without throwing', async () => {
    const out = await executeTool('read_file', { path: '../../etc/passwd' }, { cwd });
    expect(out).toMatch(/^Error:/);
  });
  it('reports an unknown tool', async () => {
    expect(await executeTool('nope', {}, { cwd })).toContain('unknown tool');
  });
});

describe('executeTool — new tools', () => {
  const cwd = '/proj';

  it('edit_file replaces an exact substring and reports a diff stat', async () => {
    const readFile = vi.fn().mockResolvedValue('hello world\nsecond line');
    const writeFile = vi.fn().mockResolvedValue();
    const out = await executeTool('edit_file', { path: 'a.txt', find: 'world', replace: 'there' }, { cwd, readFile, writeFile });
    expect(writeFile.mock.calls[0][1]).toBe('hello there\nsecond line');
    expect(out).toMatch(/Edited a\.txt/);
  });
  it('edit_file errors when the find text is absent', async () => {
    const readFile = vi.fn().mockResolvedValue('nothing here');
    const out = await executeTool('edit_file', { path: 'a.txt', find: 'zzz', replace: 'x' }, { cwd, readFile, writeFile: vi.fn() });
    expect(out).toMatch(/not found/);
  });

  it('grep finds matching lines as path:line:text', async () => {
    const readdir = vi.fn().mockResolvedValue([{ name: 'a.js', isDirectory: () => false }]);
    const readFile = vi.fn().mockResolvedValue('alpha\nfindme here\nbeta');
    const out = await executeTool('grep', { pattern: 'findme' }, { cwd, readdir, readFile });
    expect(out).toBe('a.js:2:findme here');
  });

  it('glob matches files by pattern', async () => {
    const readdir = vi.fn().mockResolvedValue([
      { name: 'a.js', isDirectory: () => false },
      { name: 'b.css', isDirectory: () => false },
    ]);
    const out = await executeTool('glob', { pattern: '*.js' }, { cwd, readdir });
    expect(out).toBe('a.js');
  });

  it('read_url posts to the web/read endpoint and returns text', async () => {
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'T', text: 'body' }), { status: 200 }));
    const out = await executeTool('read_url', { url: 'x.com' }, { cwd, cfg: { baseUrl: 'http://h/api/v1', token: 't' }, httpFetch });
    expect(httpFetch.mock.calls[0][0]).toBe('http://h/api/web/read');
    expect(out).toContain('body');
  });

  it('search_web formats answer + hits', async () => {
    const body = { answer: 'A', hits: [{ title: 'H', url: 'u', snippet: 's' }] };
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await executeTool('search_web', { query: 'q' }, { cwd, cfg: { baseUrl: 'http://h/api/v1', token: 't' }, httpFetch });
    expect(out).toContain('Answer: A');
    expect(out).toContain('H');
  });

  it('image_gen saves the decoded image to a file', async () => {
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('img').toString('base64');
    const httpFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ dataUrl }), { status: 200 }));
    const writeFile = vi.fn().mockResolvedValue();
    const mkdir = vi.fn().mockResolvedValue();
    const out = await executeTool('image_gen', { prompt: 'a cat', path: 'public/c.jpg' },
      { cwd, cfg: { baseUrl: 'http://h/api/v1', token: 't' }, httpFetch, writeFile, mkdir });
    expect(writeFile).toHaveBeenCalled();
    expect(out).toContain('public/c.jpg');
  });

  it('start_server picks a free port, sets PORT env, and never uses 3000', async () => {
    const child = { stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {} };
    const spawn = vi.fn(() => child);
    const findFreePort = vi.fn().mockResolvedValue(4321);
    const servers = new Map();
    const out = await executeTool('start_server', { command: 'node server.js' },
      { cwd, spawn, findFreePort, servers, startupDelayMs: 0 });
    expect(spawn.mock.calls[0][1].env.PORT).toBe('4321');
    expect(out).toContain('http://localhost:4321');
    expect(servers.has(4321)).toBe(true);
  });
});

describe('computeFileChange', () => {
  it('returns before/after for a write', async () => {
    const readFile = vi.fn().mockResolvedValue('old');
    expect(await computeFileChange('write_file', { path: 'a', content: 'new' }, '/p', readFile)).toEqual({ before: 'old', after: 'new' });
  });
  it('returns null for an edit whose find text is missing', async () => {
    const readFile = vi.fn().mockResolvedValue('abc');
    expect(await computeFileChange('edit_file', { path: 'a', find: 'zzz', replace: 'x' }, '/p', readFile)).toBeNull();
  });
});

describe('runAgentTurn', () => {
  const noopPrint = { assistant: () => {}, tool: () => {}, toolResult: () => {} };

  it('runs a tool then returns the final answer, recording tool results', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ ok: true, message: { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'run_command', arguments: '{"command":"ls"}' } }] }, provider: 'groq/x' })
      .mockResolvedValueOnce({ ok: true, message: { role: 'assistant', content: 'Done.' }, provider: 'groq/x' });
    const exec = vi.fn().mockResolvedValue({ stdout: 'file.txt', stderr: '' });
    const confirm = vi.fn().mockResolvedValue('y');

    const messages = [{ role: 'user', content: 'list files' }];
    const r = await runAgentTurn({
      model: 'auto-smart', messages, cwd: '/proj', approvals: { all: new Set() },
      complete, confirm, print: noopPrint, toolDeps: { exec },
    });

    expect(r.ok).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenCalledOnce();
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg.content).toContain('file.txt');
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Done.' });
  });

  it('skips a denied tool and feeds back a denial, without executing', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ ok: true, message: { tool_calls: [{ id: 't1', function: { name: 'run_command', arguments: '{"command":"rm -rf /"}' } }] } })
      .mockResolvedValueOnce({ ok: true, message: { content: 'OK, skipped.' } });
    const exec = vi.fn();
    const confirm = vi.fn().mockResolvedValue('n');

    const messages = [{ role: 'user', content: 'delete everything' }];
    const r = await runAgentTurn({
      model: 'm', messages, cwd: '/proj', approvals: { all: new Set() },
      complete, confirm, print: noopPrint, toolDeps: { exec },
    });

    expect(r.ok).toBe(true);
    expect(exec).not.toHaveBeenCalled();
    expect(messages.find((m) => m.role === 'tool').content).toMatch(/Denied/);
  });

  it('auto-approves when the tool is in the always-allow set', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ ok: true, message: { tool_calls: [{ id: 't1', function: { name: 'run_command', arguments: '{"command":"ls"}' } }] } })
      .mockResolvedValueOnce({ ok: true, message: { content: 'done' } });
    const confirm = vi.fn();
    const exec = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });

    await runAgentTurn({
      model: 'm', messages: [{ role: 'user', content: 'go' }], cwd: '/proj',
      approvals: { all: new Set(['run_command']) }, complete, confirm, print: noopPrint, toolDeps: { exec },
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledOnce();
  });

  it('pins to the first provider for later steps', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ ok: true, message: { tool_calls: [{ id: 't1', function: { name: 'list_dir', arguments: '{}' } }] }, provider: 'gemini/g3' })
      .mockResolvedValueOnce({ ok: true, message: { content: 'done' }, provider: 'gemini/g3' });
    const readdir = vi.fn().mockResolvedValue([]);
    await runAgentTurn({
      model: 'auto-smart', messages: [{ role: 'user', content: 'go' }], cwd: '/proj',
      approvals: { all: new Set() }, complete, confirm: vi.fn(), print: noopPrint, toolDeps: { readdir },
    });
    expect(complete.mock.calls[0][0]).toBe('auto-smart');
    expect(complete.mock.calls[1][0]).toBe('gemini/g3'); // pinned after the first response
  });

  it('dedups an identical consecutive tool call', async () => {
    const lsCall = { tool_calls: [{ id: 't', function: { name: 'list_dir', arguments: '{}' } }] };
    const complete = vi.fn()
      .mockResolvedValueOnce({ ok: true, message: lsCall })
      .mockResolvedValueOnce({ ok: true, message: lsCall })
      .mockResolvedValueOnce({ ok: true, message: { content: 'done' } });
    const readdir = vi.fn().mockResolvedValue([]);
    const messages = [{ role: 'user', content: 'go' }];
    await runAgentTurn({
      model: 'm', messages, cwd: '/proj', approvals: { all: new Set() },
      complete, confirm: vi.fn(), print: noopPrint, toolDeps: { readdir },
    });
    expect(readdir).toHaveBeenCalledTimes(1); // the identical second call is skipped
    expect(messages.filter((m) => m.role === 'tool').some((m) => /identical/i.test(m.content))).toBe(true);
  });

  it('applies an edited command from confirm (edit-before-run)', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ ok: true, message: { tool_calls: [{ id: 't', function: { name: 'run_command', arguments: '{"command":"npm run dev"}' } }] } })
      .mockResolvedValueOnce({ ok: true, message: { content: 'done' } });
    const exec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const confirm = vi.fn().mockResolvedValue({ decision: 'y', command: 'npm run dev -- --port 5173' });
    await runAgentTurn({
      model: 'm', messages: [{ role: 'user', content: 'go' }], cwd: '/proj',
      approvals: { all: new Set() }, complete, confirm, print: noopPrint, toolDeps: { exec },
    });
    expect(exec.mock.calls[0][0]).toBe('npm run dev -- --port 5173');
  });

  it('surfaces a completion error', async () => {
    const complete = vi.fn().mockResolvedValue({ ok: false, error: 'no capable model' });
    const r = await runAgentTurn({
      model: 'm', messages: [{ role: 'user', content: 'go' }], cwd: '/proj',
      approvals: { all: new Set() }, complete, confirm: vi.fn(), print: noopPrint,
    });
    expect(r).toMatchObject({ ok: false, error: 'no capable model' });
  });

  it('stops after the step limit', async () => {
    // Always returns a tool call → would loop forever without the cap.
    const complete = vi.fn().mockResolvedValue({ ok: true, message: { tool_calls: [{ id: 't', function: { name: 'list_dir', arguments: '{}' } }] } });
    const readdir = vi.fn().mockResolvedValue([]);
    const r = await runAgentTurn({
      model: 'm', messages: [{ role: 'user', content: 'go' }], cwd: '/proj',
      approvals: { all: new Set() }, complete, confirm: vi.fn(), print: noopPrint, toolDeps: { readdir }, maxSteps: 3,
    });
    expect(r.truncated).toBe(true);
    expect(complete).toHaveBeenCalledTimes(3);
  });
});
