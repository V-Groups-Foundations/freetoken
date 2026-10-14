import { describe, it, expect, vi } from 'vitest';
import {
  TOOLS, agentSystemPrompt, classifyPermission, isDangerous, parseToolCalls,
  truncate, safeResolve, executeTool, runAgentTurn,
} from '../../src/cli/agent.mjs';

describe('tool specs', () => {
  it('exposes the four tools', () => {
    expect(TOOLS.map((t) => t.function.name).sort()).toEqual(['list_dir', 'read_file', 'run_command', 'write_file']);
  });
  it('puts the cwd in the system prompt', () => {
    expect(agentSystemPrompt('/tmp/proj')).toContain('/tmp/proj');
  });
});

describe('classifyPermission', () => {
  it('auto-runs read-only tools, confirms mutating ones', () => {
    expect(classifyPermission('read_file')).toBe('auto');
    expect(classifyPermission('list_dir')).toBe('auto');
    expect(classifyPermission('run_command')).toBe('confirm');
    expect(classifyPermission('write_file')).toBe('confirm');
  });
});

describe('isDangerous', () => {
  it('flags destructive commands', () => {
    expect(isDangerous('rm -rf /')).toBe(true);
    expect(isDangerous('sudo rm -rf ~/')).toBe(true);
    expect(isDangerous('git push origin main --force')).toBe(true);
    expect(isDangerous('shutdown now')).toBe(true);
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
    expect(out).toContain('Wrote src/a.txt');
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
