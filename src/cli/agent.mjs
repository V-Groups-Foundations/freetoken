// The FreeToken coding agent: tool definitions, an OpenAI-style tool-call loop, sandboxed
// executors, and a safety classifier. Everything here is pure or dependency-injected so the
// whole agent can be unit-tested without a network, a shell, or the filesystem.

import { exec as _exec, spawn as _spawn } from 'node:child_process';
import { readFile as _readFile, writeFile as _writeFile, readdir as _readdir, mkdir as _mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { findFreePort as _findFreePort } from './ports.mjs';
import { lineDiff, diffStat } from './diff.mjs';

const execAsync = promisify(_exec);

/** System prompt that turns a chat model into an agent. {{CWD}} is replaced with the real folder. */
export function agentSystemPrompt(cwd) {
  return [
    'You are FreeToken Agent, a hands-on coding assistant working inside the user’s project folder.',
    'You have tools to run shell commands and read, write, and list files. Actually use them —',
    'inspect the project, make changes, run builds/tests, and verify results. Work in small, verifiable steps.',
    'Never claim you did something unless a tool result shows it. When finished, give a brief summary of what you changed.',
    '',
    'CRITICAL environment rules:',
    '- Port 3000 is RESERVED by the FreeToken backend you rely on. NEVER start a server on port 3000,',
    '  and NEVER kill a process, free a port, or run taskkill/kill/netstat-based termination — doing so',
    '  breaks your own connection. If port 3000 seems busy, that is expected; it is not your app.',
    '- When you create or run a web server/dev server, use a different port (e.g. 4321, 5173, or 8080),',
    '  set it explicitly in the code, run it in the background, then tell the user the exact URL to open.',
    '- Use only the tools provided (run_command, read_file, write_file, list_dir). Do not invent tool names.',
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
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Make a targeted edit to a file by replacing an exact substring. Safer than rewriting the whole file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          find: { type: 'string', description: 'Exact text to find (must occur in the file).' },
          replace: { type: 'string', description: 'Text to replace it with.' },
        },
        required: ['path', 'find', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents under the project for a regular expression. Returns path:line:match.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Subdirectory to search (default ".").' } },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a glob pattern (supports **, *, ?) under the project directory.',
      parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_url',
      description: 'Fetch a web page and return its main content as clean text (for looking up docs/APIs).',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web and return a synthesized answer plus source links (needs a connected Tavily key).',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'image_gen',
      description: 'Generate an image from a text prompt and save it to a file in the project (for assets/placeholders).',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string' }, path: { type: 'string', description: 'Output file, e.g. "public/hero.jpg".' } },
        required: ['prompt', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_server',
      description: 'Start a long-running dev/web server in the background on an auto-chosen free port (never 3000). '
        + 'The chosen port is exposed to the command as the PORT env var; make your server read process.env.PORT. '
        + 'Returns the URL and the first lines of output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to launch the server, e.g. "node server.js".' },
          port: { type: 'number', description: 'Preferred port (optional; ignored if busy or 3000).' },
        },
        required: ['command'],
      },
    },
  },
];

const READ_ONLY = new Set(['read_file', 'list_dir', 'grep', 'glob', 'read_url', 'search_web']);

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
  /\btaskkill\b/i,
  /\bkill\s+(-\w+\s+)?\d/i,
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

/** Compute what a write_file / edit_file would change, for a diff preview. Returns { before, after } or null. */
export async function computeFileChange(name, args, cwd, readFile = _readFile) {
  try {
    const abs = safeResolve(cwd, args.path);
    let before = '';
    try { before = await readFile(abs, 'utf8'); } catch { before = ''; }
    if (name === 'write_file') return { before, after: String(args.content ?? '') };
    if (name === 'edit_file') {
      if (typeof args.find !== 'string' || !args.find) return null;
      if (!before.includes(args.find)) return null;
      return { before, after: before.split(args.find).join(String(args.replace ?? '')) };
    }
    return null;
  } catch {
    return null;
  }
}

const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache']);

async function walkFiles(root, cwd, readdir, { max = 2000 } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) stack.push(abs); }
      else out.push(relative(cwd, abs).split('\\').join('/'));
    }
  }
  return out;
}

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The FreeToken app origin (base URL without the /api/v1 suffix). */
function apiOrigin(cfg) {
  return String(cfg.baseUrl).replace(/\/api\/v1\/?$/, '');
}
function authJson(cfg) {
  return { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` };
}

/** Execute one tool. All side-effecting deps are injectable for testing. */
export async function executeTool(name, args, ctx) {
  const {
    cwd, exec = execAsync, readFile = _readFile, writeFile = _writeFile, readdir = _readdir, mkdir = _mkdir,
    cfg, httpFetch = fetch, servers, spawn = _spawn, findFreePort = _findFreePort, startupDelayMs = 1500,
  } = ctx;
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
      let before = '';
      try { before = await readFile(abs, 'utf8'); } catch { before = ''; }
      await mkdir(dirname(abs), { recursive: true });
      const content = String(args.content ?? '');
      await writeFile(abs, content, 'utf8');
      const { added, removed } = diffStat(lineDiff(before, content));
      return before ? `Updated ${args.path} (+${added} -${removed}).` : `Created ${args.path} (${content.length} bytes).`;
    }

    if (name === 'list_dir') {
      const entries = await readdir(safeResolve(cwd, args.path || '.'), { withFileTypes: true });
      const names = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return truncate(names.join('\n') || '(empty directory)');
    }

    if (name === 'edit_file') {
      const abs = safeResolve(cwd, args.path);
      const before = await readFile(abs, 'utf8');
      if (typeof args.find !== 'string' || !args.find) return 'Error: "find" text is required.';
      if (!before.includes(args.find)) return `Error: the "find" text was not found in ${args.path}. Read the file and match it exactly.`;
      const after = before.split(args.find).join(String(args.replace ?? ''));
      await writeFile(abs, after, 'utf8');
      const { added, removed } = diffStat(lineDiff(before, after));
      return `Edited ${args.path} (+${added} -${removed}).`;
    }

    if (name === 'grep') {
      let re;
      try { re = new RegExp(args.pattern, 'i'); } catch { return `Error: invalid regex: ${args.pattern}`; }
      const base = safeResolve(cwd, args.path || '.');
      const files = await walkFiles(base, cwd, readdir);
      const hits = [];
      for (const rel of files) {
        if (hits.length >= 200) break;
        let text;
        try { text = await readFile(safeResolve(cwd, rel), 'utf8'); } catch { continue; }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) { hits.push(`${rel}:${i + 1}:${lines[i].trim().slice(0, 200)}`); if (hits.length >= 200) break; }
        }
      }
      return truncate(hits.join('\n') || '(no matches)');
    }

    if (name === 'glob') {
      const re = globToRegExp(args.pattern);
      const files = await walkFiles(cwd, cwd, readdir);
      const matched = files.filter((f) => re.test(f));
      return truncate(matched.join('\n') || '(no files match)');
    }

    if (name === 'read_url') {
      if (!cfg) return 'Error: web tools are unavailable in this context.';
      const res = await httpFetch(`${apiOrigin(cfg)}/api/web/read`, {
        method: 'POST', headers: authJson(cfg), body: JSON.stringify({ url: args.url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return `Error: ${data?.error ?? `read failed (HTTP ${res.status})`}`;
      return truncate(`# ${data.title ?? args.url}\n${data.text ?? ''}`);
    }

    if (name === 'search_web') {
      if (!cfg) return 'Error: web tools are unavailable in this context.';
      const res = await httpFetch(`${apiOrigin(cfg)}/api/web/search`, {
        method: 'POST', headers: authJson(cfg), body: JSON.stringify({ query: args.query }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return `Error: ${data?.error ?? `search failed (HTTP ${res.status})`}`;
      const hits = (data.hits ?? []).map((h, i) => `[${i + 1}] ${h.title}\n    ${h.url}\n    ${h.snippet}`).join('\n');
      return truncate([data.answer && `Answer: ${data.answer}`, hits].filter(Boolean).join('\n\n') || '(no results)');
    }

    if (name === 'image_gen') {
      if (!cfg) return 'Error: image generation is unavailable in this context.';
      const res = await httpFetch(`${apiOrigin(cfg)}/api/images`, {
        method: 'POST', headers: authJson(cfg), body: JSON.stringify({ prompt: args.prompt }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.dataUrl) return `Error: ${data?.error?.message ?? `image generation failed (HTTP ${res.status})`}`;
      const b64 = String(data.dataUrl).split(',')[1] ?? '';
      const abs = safeResolve(cwd, args.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, Buffer.from(b64, 'base64'));
      return `Saved generated image to ${args.path}.`;
    }

    if (name === 'start_server') {
      if (!servers) return 'Error: server management is unavailable in this context.';
      if (typeof args.command !== 'string' || !args.command.trim()) return 'Error: no command provided.';
      const port = await findFreePort(args.port);
      const child = spawn(args.command, { cwd, shell: true, env: { ...process.env, PORT: String(port) }, windowsHide: true });
      const logs = [];
      const collect = (buf) => { logs.push(buf.toString()); if (logs.length > 200) logs.shift(); };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      let exited = null;
      child.on('exit', (code) => { exited = code; });
      servers.set(port, { child, command: args.command, port, logs });
      await new Promise((r) => setTimeout(r, startupDelayMs));
      const tail = truncate(logs.join('').split('\n').slice(-12).join('\n'), 2000);
      if (exited !== null) return `The server exited immediately (code ${exited}).\n${tail}`;
      return `Started "${args.command}" on http://localhost:${port} (PORT=${port}). Recent output:\n${tail || '(no output yet)'}`;
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
  let lastSig = null;

  for (let step = 0; step < maxSteps; step++) {
    let res = await complete(currentModel, messages);
    if (!res.ok && currentModel !== model) res = await complete(model, messages); // unpin & retry once
    if (!res.ok) return { ok: false, error: res.error, messages };
    if (res.provider) currentModel = res.provider;

    const msg = res.message ?? {};
    messages.push(msg);
    // When the completion streamed, its content + footer were already printed live.
    if (msg.content && !res.streamed) print.assistant(msg.content, res.provider, res.usage);

    const calls = parseToolCalls(msg);
    if (calls.length === 0) return { ok: true, messages };

    for (const call of calls) {
      const sig = `${call.name}\u0000${JSON.stringify(call.args ?? {})}`;

      // Dedup: an identical call to the one just executed wastes a round-trip.
      if (sig === lastSig) {
        const note = 'Skipped: identical to the previous tool call. Use that result instead of repeating.';
        print.tool(call, true);
        print.toolResult(call, note, true, 0);
        messages.push({ role: 'tool', tool_call_id: call.id, content: note });
        continue;
      }

      let allowed = true;
      if (classifyPermission(call.name) === 'confirm' && !approvals.all.has(call.name)) {
        const danger = call.name === 'run_command' && isDangerous(call.args?.command);
        const raw = await confirm(call, danger);
        const decision = typeof raw === 'string' ? raw : raw?.decision;
        // Edit-before-run: confirm may hand back an amended command.
        if (raw && typeof raw === 'object' && typeof raw.command === 'string' && call.name === 'run_command') {
          call.args.command = raw.command;
        }
        if (decision === 'a') approvals.all.add(call.name);
        allowed = decision === 'a' || decision === 'y';
      }

      print.tool(call, allowed);
      const t0 = Date.now();
      const result = allowed
        ? await executeTool(call.name, call.args, { cwd, ...toolDeps })
        : 'Denied by the user. Do not retry this exact action; ask how to proceed or try a different approach.';
      print.toolResult(call, result, allowed, Date.now() - t0);

      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      lastSig = sig;
    }
  }

  return { ok: true, messages, truncated: true };
}
