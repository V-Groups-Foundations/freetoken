// The FreeToken coding agent: tool definitions, an OpenAI-style tool-call loop, sandboxed
// executors, and a safety classifier. Everything here is pure or dependency-injected so the
// whole agent can be unit-tested without a network, a shell, or the filesystem.

import { exec as _exec } from 'node:child_process';
import { readFile as _readFile, writeFile as _writeFile, readdir as _readdir, mkdir as _mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute, dirname } from 'node:path';

const execAsync = promisify(_exec);

/** System prompt that turns a chat model into an agent. {{CWD}} is replaced with the real folder. */
export function agentSystemPrompt(cwd) {
  return [
    'You are FreeToken Agent, a hands-on coding assistant working inside the user’s project folder.',
    'You have tools to run shell commands and read, write, and list files. Actually use them —',
    'inspect the project, make changes, run builds/tests, and verify results. Work in small, verifiable steps.',
    'Never claim you did something unless a tool result shows it. When finished, give a brief summary of what you changed.',
    `The working directory is: ${cwd}`,
  ].join('\n');
}

/** OpenAI-compatible tool specs sent to the model each turn. */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the project directory. Returns stdout, stderr, and the exit code.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The shell command to run.' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file, path relative to the project directory.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a UTF-8 text file, path relative to the project directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the entries of a directory, path relative to the project directory (defaults to ".").',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  },
];

const READ_ONLY = new Set(['read_file', 'list_dir']);

/** Read-only tools run automatically; mutating tools need confirmation. */
export function classifyPermission(name) {
  return READ_ONLY.has(name) ? 'auto' : 'confirm';
}

// Commands worth an extra warning before running.
const DANGER = [
  /\brm\s+-[a-z]*r[a-z]*f?\s+[/~]/i,
  /\brm\s+-[a-z]*f[a-z]*r?\s+[/~]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, // fork bomb
  /\b(shutdown|reboot|halt)\b/i,
  /\bgit\s+push\b.*--force/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bformat\s+[a-z]:/i,
];

export function isDangerous(command) {
  return typeof command === 'string' && DANGER.some((re) => re.test(command));
}

/** Normalize a model's tool_calls into [{ id, name, args }], flagging un-parseable arguments. */
export function parseToolCalls(message) {
  const calls = message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((tc) => {
    let args = {};
    const raw = tc?.function?.arguments;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        args = JSON.parse(raw);
      } catch {
        args = { __parseError: true, raw };
      }
    }
    return { id: tc?.id, name: tc?.function?.name, args };
  });
}

/** Cap a tool result so a huge file or log can't blow the request budget. */
export function truncate(text, max = 12000) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

/** Resolve a user/model-supplied path and refuse anything that escapes the project folder. */
export function safeResolve(cwd, p) {
  if (typeof p !== 'string' || !p) throw new Error('A path is required.');
  const abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel === '') return abs;
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path escapes the project folder: ${p}`);
  return abs;
}

/** Execute one tool. All side-effecting deps are injectable for testing. */
export async function executeTool(name, args, ctx) {
  const { cwd, exec = execAsync, readFile = _readFile, writeFile = _writeFile, readdir = _readdir, mkdir = _mkdir } = ctx;
  if (args?.__parseError) return `Error: could not parse tool arguments: ${args.raw ?? ''}`;

  try {
    if (name === 'run_command') {
      if (typeof args.command !== 'string' || !args.command.trim()) return 'Error: no command provided.';
      let stdout = '';
      let stderr = '';
      try {
        const r = await exec(args.command, { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
        stdout = r.stdout ?? '';
        stderr = r.stderr ?? '';
      } catch (e) {
        stdout = e.stdout ?? '';
        stderr = `${e.stderr ?? ''}\n[exit ${e.code ?? '?'}] ${e.message ?? ''}`.trim();
      }
      const out = [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join('\n\n');
      return truncate(out || '(no output)');
    }

    if (name === 'read_file') {
      return truncate(await readFile(safeResolve(cwd, args.path), 'utf8'));
    }

    if (name === 'write_file') {
      const abs = safeResolve(cwd, args.path);
      await mkdir(dirname(abs), { recursive: true });
      const content = String(args.content ?? '');
      await writeFile(abs, content, 'utf8');
      return `Wrote ${args.path} (${content.length} bytes).`;
    }

    if (name === 'list_dir') {
      const entries = await readdir(safeResolve(cwd, args.path || '.'), { withFileTypes: true });
      const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return truncate(names.join('\n') || '(empty directory)');
    }

    return `Error: unknown tool "${name}".`;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

/**
 * Run one user turn through the tool-call loop.
 *
 * @param {object} o
 * @param {string} o.model
 * @param {Array} o.messages  Full conversation (system + history + new user message). Mutated with assistant/tool turns.
 * @param {string} o.cwd
 * @param {(model:string, messages:Array)=>Promise<{ok:boolean,message?:object,provider?:string,error?:string}>} o.complete
 * @param {(call:object, danger:boolean)=>Promise<'y'|'n'|'a'>} o.confirm
 * @param {{assistant:Function, tool:Function, toolResult:Function}} o.print
 * @param {{all:Set<string>}} o.approvals  Session approvals ("always allow" per tool).
 * @param {object} [o.toolDeps]  Injected executor deps (exec/readFile/…); defaults to real fs/shell.
 * @param {number} [o.maxSteps]
 */
export async function runAgentTurn(o) {
  const { model, messages, cwd, complete, confirm, print, approvals, toolDeps = {}, maxSteps = 25 } = o;

  // Pin to whichever provider answers first, so a multi-step task stays on one provider.
  // Mixing providers mid-task breaks tool continuity (e.g. Gemini's thought_signature).
  let currentModel = model;

  for (let step = 0; step < maxSteps; step++) {
    let res = await complete(currentModel, messages);
    if (!res.ok && currentModel !== model) res = await complete(model, messages); // unpin & retry once
    if (!res.ok) return { ok: false, error: res.error, messages };
    if (res.provider) currentModel = res.provider;

    const msg = res.message ?? {};
    messages.push(msg);
    if (msg.content) print.assistant(msg.content, res.provider);

    const calls = parseToolCalls(msg);
    if (calls.length === 0) return { ok: true, messages };

    for (const call of calls) {
      let allowed = true;
      if (classifyPermission(call.name) === 'confirm' && !approvals.all.has(call.name)) {
        const danger = call.name === 'run_command' && isDangerous(call.args?.command);
        const ans = await confirm(call, danger);
        if (ans === 'a') approvals.all.add(call.name);
        allowed = ans === 'a' || ans === 'y';
      }

      print.tool(call, allowed);
      const result = allowed
        ? await executeTool(call.name, call.args, { cwd, ...toolDeps })
        : 'Denied by the user. Do not retry this exact action; ask how to proceed or try a different approach.';
      print.toolResult(call, result, allowed);

      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  return { ok: true, messages, truncated: true };
}
