#!/usr/bin/env node
// FreeToken terminal client. Talks to your FreeToken /api/v1 endpoint with an ft_ token.
// Run:  node bin/freetoken.mjs   (or, once linked, `freetoken`)
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { envFor, launchPlan, originOf as originOfBase, setupText } from '../src/cli/integrations.mjs';
import { basename } from 'node:path';
import { stdin, stdout, env, argv, exit, chdir, cwd } from 'node:process';
import { resolveConfig, deltaFromLine, parseArgs, applyCommand, sanitizeFolderName, renderTranscript, toApiMessages, expandMentions } from '../src/cli/core.mjs';
import { runAgentTurn, agentSystemPrompt, TOOLS, computeFileChange } from '../src/cli/agent.mjs';
import { renderMarkdown } from '../src/cli/render.mjs';
import { lineDiff, renderDiff } from '../src/cli/diff.mjs';
import { parseSseLine, newStreamState, applyChunk, finalizeMessage } from '../src/cli/stream-parse.mjs';

const CONFIG_PATH = join(homedir(), '.freetoken', 'config.json');

/** The user's Desktop, following OneDrive redirection when present. */
function desktopDir() {
  const candidates = [
    env.USERPROFILE && join(env.USERPROFILE, 'Desktop'),
    env.OneDrive && join(env.OneDrive, 'Desktop'),
    join(homedir(), 'OneDrive', 'Desktop'),
    join(homedir(), 'Desktop'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? join(homedir(), 'Desktop');
}

/** Create (if needed) and return Desktop/FreeToken/<project name>/, cd into it, drop a marker. */
async function ensureProjectFolder(projectId, projectName) {
  const dir = join(desktopDir(), 'FreeToken', sanitizeFolderName(projectName));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'project.json'),
    JSON.stringify({ id: projectId, name: projectName, baseUrl: null }, null, 2),
  );
  chdir(dir);
  return dir;
}

async function writeTranscript(dir, projectName, messages) {
  try {
    await writeFile(join(dir, 'transcript.md'), renderTranscript(projectName, messages));
  } catch {
    /* non-fatal */
  }
}

/** If the current folder is a FreeToken project folder, read its id + name. */
async function projectFromCwd() {
  try {
    const j = JSON.parse(await readFile(join(cwd(), 'project.json'), 'utf8'));
    return j.id ? { id: j.id, name: j.name ?? j.id } : null;
  } catch {
    return null;
  }
}

// Minimal ANSI styling; disabled when output is not a TTY or NO_COLOR is set.
const useColor = stdout.isTTY && !env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);
const cyan = (s) => c('36', s);
const azure = (s) => c('38;5;39', s); // a nicer blue accent (replaces green)
const red = (s) => c('31', s);
const yellow = (s) => c('33', s);

async function loadConfigFile() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function saveConfigFile(data) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function runLogin() {
  const rl = createInterface({ input: stdin, output: stdout });
  const existing = (await loadConfigFile()) ?? {};
  const baseUrl =
    (await ask(rl, `Base URL [${existing.baseUrl ?? 'http://localhost:3000/api/v1'}]: `)) ||
    existing.baseUrl ||
    'http://localhost:3000/api/v1';
  const token = (await ask(rl, 'API token (ft_...): ')) || existing.token;
  rl.close();
  if (!token) {
    console.error(red('No token given. Create one on the website under API, then run `freetoken login`.'));
    exit(1);
  }
  await saveConfigFile({ baseUrl: baseUrl.replace(/\/+$/, ''), token });
  console.log(cyan(`Saved to ${CONFIG_PATH}`));
}

async function fetchModels(cfg) {
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, { headers: { authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) return [];
    return (await res.json()).data?.map((m) => m.id) ?? [];
  } catch {
    return [];
  }
}

const projectOrigin = (baseUrl) => baseUrl.replace(/\/api\/v1\/?$/, '');

/** Load a project's saved conversation so the terminal shows the whole thread. */
async function fetchProjectHistory(cfg, project) {
  try {
    const res = await fetch(`${projectOrigin(cfg.baseUrl)}/api/projects/${project}/messages`, {
      headers: { authorization: `Bearer ${cfg.token}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { name: j.project?.name ?? project, messages: j.messages ?? [] };
  } catch {
    return null;
  }
}

function printHistory(messages) {
  for (const m of messages) {
    if (m.role === 'user') stdout.write(cyan('› ') + m.content + '\n');
    else stdout.write(dim(`  (${m.provider ?? 'assistant'})\n`) + m.content + '\n');
  }
}

function originOf(baseUrl) {
  // baseUrl is .../api/v1 ; project routes live at .../api/projects/:id/chat
  return baseUrl.replace(/\/api\/v1\/?$/, '');
}

/**
 * Stream one reply. In a project, posts {content} to the project endpoint (shared memory);
 * otherwise posts the full message list to the stateless completions endpoint.
 * @returns {Promise<{provider:string|null, ok:boolean, error?:string, text?:string}>}
 */
async function streamChat(cfg, model, messages, project) {
  const url = project
    ? `${originOf(cfg.baseUrl)}/api/projects/${project}/chat`
    : `${cfg.baseUrl}/chat/completions`;
  const payload = project
    ? { content: messages[messages.length - 1].content }
    : { model, messages: toApiMessages(messages), stream: true };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { provider: null, ok: false, error: `Could not reach ${url} (${e.message}).` };
  }
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json())?.error?.message ?? msg;
    } catch {
      /* keep status */
    }
    return { provider: null, ok: false, error: msg };
  }

  const provider = res.headers.get('x-freetoken-provider');
  if (provider) stdout.write(dim(`  (${provider})\n`));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const delta = deltaFromLine(line);
      if (delta?.content) {
        full += delta.content;
        stdout.write(delta.content);
      }
    }
  }
  stdout.write('\n');
  return { provider, ok: true, text: full };
}

function printHelp() {
  console.log(
    [
      bold('Commands'),
      '  /agent        agent mode — the model can run commands & edit files (you approve each)',
      '  /chat         plain chat mode (no tools)',
      '  /plan <task>  propose a plan first, then run it on approval',
      '  /model <id>   switch model (e.g. auto-smart, auto-fast, groq/…)',
      '  /project <id> use a project (shared memory with the web app); blank to leave',
      '  /models       list your available models',
      '  /last         reprint the full output of the last tool',
      '  /clear        start a new conversation',
      '  /help         show this help',
      '  /exit         quit',
      '',
      dim('In agent mode: y = run once · a = always allow this tool · e = edit the command · n = skip.'),
      dim('Ctrl-C interrupts the current turn. End a line with \\ for multi-line input. Use @path to attach a file. Tab completes.'),
    ].join('\n'),
  );
}

// ---- Agent mode: tool-call loop against /chat/completions ----

// The in-flight model request, so Ctrl-C can abort just the request (not the whole CLI).
let activeController = null;

/** One non-streaming completion with tools, for the agent loop / planning. */
async function agentComplete(cfg, model, messages) {
  let res;
  const controller = new AbortController();
  activeController = controller;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ model, messages: toApiMessages(messages), tools: TOOLS, stream: false }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, aborted: true, error: 'interrupted' };
    return { ok: false, error: `Could not reach ${cfg.baseUrl} (${e.message}).` };
  } finally {
    activeController = null;
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error?.message ?? msg; } catch { /* keep status */ }
    return { ok: false, error: msg };
  }
  const json = await res.json().catch(() => null);
  const choice = json?.choices?.[0];
  if (!choice) return { ok: false, error: 'The model returned an empty response.' };
  return { ok: true, message: choice.message ?? {}, provider: res.headers.get('x-freetoken-provider') };
}

/** Stream one completion (content + tool-call deltas), printing text live. Falls back to non-stream. */
async function streamingComplete(cfg, model, messages, { onStart, onDelta }) {
  let res;
  const controller = new AbortController();
  activeController = controller;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ model, messages: toApiMessages(messages), tools: TOOLS, stream: true, stream_options: { include_usage: true } }),
      signal: controller.signal,
    });
  } catch (e) {
    activeController = null;
    if (e.name === 'AbortError') return { ok: false, aborted: true, error: 'interrupted' };
    return { ok: false, error: `Could not reach ${cfg.baseUrl} (${e.message}).` };
  }
  if (!res.ok || !res.body) {
    activeController = null;
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error?.message ?? msg; } catch { /* keep status */ }
    return { ok: false, error: msg };
  }

  const provider = res.headers.get('x-freetoken-provider');
  const state = newStreamState();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let started = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseSseLine(line);
        if (!parsed || parsed === 'done') continue;
        const delta = applyChunk(state, parsed);
        if (delta) { if (!started) { onStart?.(); started = true; } onDelta?.(delta); }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, aborted: true, error: 'interrupted' };
    return { ok: false, error: `Stream error: ${e.message}` };
  } finally {
    activeController = null;
  }
  return { ok: true, message: finalizeMessage(state), provider, usage: state.usage, streamed: true, started };
}

/** The complete() the agent loop uses: spinner → live stream → footer, with non-stream fallback. */
function makeComplete(cfg) {
  return async (model, messages) => {
    const stop = startSpinner('thinking…');
    const res = await streamingComplete(cfg, model, messages, {
      onStart: () => { stop(); stdout.write('\n'); },
      onDelta: (d) => stdout.write(d),
    });
    stop();
    if (!res.ok) {
      if (res.aborted) return res; // user interrupted — don't retry
      return agentComplete(cfg, model, messages); // provider didn't stream — fall back
    }
    if (res.started) {
      stdout.write('\n');
      const tok = res.usage?.total_tokens ?? res.usage?.completion_tokens;
      if (typeof tok === 'number') sessionTokens += tok;
      const meta = [res.provider, typeof tok === 'number' ? `${tok} tok` : null].filter(Boolean).join(' · ');
      if (meta) stdout.write(dim(`  ↳ ${meta}\n`));
    }
    return res;
  };
}

const VERB = {
  run_command: 'Run', write_file: 'Write', read_file: 'Read', list_dir: 'List', edit_file: 'Edit',
  grep: 'Grep', glob: 'Glob', read_url: 'Fetch', search_web: 'Search', image_gen: 'Image', start_server: 'Serve',
};

function toolDetail(call) {
  const a = call.args ?? {};
  switch (call.name) {
    case 'run_command': return a.command ?? '';
    case 'write_file': case 'read_file': case 'edit_file': case 'image_gen': return a.path ?? '';
    case 'list_dir': return a.path ?? '.';
    case 'grep': case 'glob': return a.pattern ?? '';
    case 'read_url': return a.url ?? '';
    case 'search_web': return a.query ?? '';
    case 'start_server': return a.command ?? '';
    default: return '';
  }
}

/** A braille spinner shown while the model thinks (TTY only). Returns a stop() function. */
function startSpinner(label) {
  if (!stdout.isTTY) return () => {};
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => stdout.write('\r' + cyan(frames[i++ % frames.length]) + dim(' ' + label)), 80);
  return () => { clearInterval(timer); stdout.write('\r\x1b[K'); };
}

let lastToolOutput = '';
let sessionTokens = 0;

const agentPrinter = {
  assistant: (text, provider, usage) => {
    stdout.write('\n' + renderMarkdown(text.trimEnd(), { color: useColor }) + '\n');
    const tok = usage?.total_tokens ?? usage?.completion_tokens;
    if (typeof tok === 'number') sessionTokens += tok;
    const meta = [provider, typeof tok === 'number' ? `${tok} tok` : null].filter(Boolean).join(' · ');
    if (meta) stdout.write(dim(`  ↳ ${meta}\n`));
  },
  tool: (call, allowed) => {
    const dot = allowed ? azure('⏺') : red('⊘');
    stdout.write(`${dot} ${bold(VERB[call.name] ?? call.name)}${dim('(' + toolDetail(call) + ')')}\n`);
  },
  toolResult: (call, result, allowed, ms) => {
    if (!allowed) { stdout.write(dim('  ⎿  skipped\n')); return; }
    lastToolOutput = String(result);
    const lines = lastToolOutput.split('\n');
    const shown = lines.slice(0, 8);
    const time = ms ? dim(` (${(ms / 1000).toFixed(1)}s)`) : '';
    stdout.write(dim('  ⎿  ' + shown.join('\n     ')) + time + '\n');
    if (lines.length > shown.length) stdout.write(dim(`     … +${lines.length - shown.length} more lines — /last to see all\n`));
  },
};

/** Read a file for an @mention, relative to the project folder; null if unreadable. */
function readMention(p) {
  try { return readFileSync(join(cwd(), p), 'utf8').slice(0, 20000); } catch { return null; }
}

/** Run a full agent exchange (one user turn, with auto-continue at the step cap). */
async function agentExchange(cfg, rl, state, firstText) {
  let userText = firstText;
  for (;;) {
    const convo = [{ role: 'system', content: agentSystemPrompt(cwd()) }, ...state.messages, { role: 'user', content: userText }];
    const result = await runAgentTurn({
      model: state.model, messages: convo, cwd: cwd(), approvals: state.approvals, print: agentPrinter,
      complete: makeComplete(cfg),
      confirm: (call, danger) => confirmTool(rl, call, danger, cwd()),
      toolDeps: { cfg, servers: state.servers },
    });
    if (!result.ok) {
      const tip = /\btool|capable\b/i.test(result.error) ? dim('\n  Tip: connect a tool-capable provider (Groq, NVIDIA, Cohere, or GitHub) at /connect.') : '';
      console.error(red(result.error) + tip);
      break;
    }
    state.messages = result.messages.filter((m) => m.role !== 'system');
    if (state.dir) await writeTranscript(state.dir, state.projectName ?? 'session', state.messages);
    if (result.truncated) {
      const go = (await ask(rl, yellow('Hit the step limit. Continue? ') + dim('[y/N]: '))).toLowerCase();
      if (go.startsWith('y')) { userText = 'continue'; continue; }
    }
    break;
  }
  printStatus(state);
}

const SLASH_COMMANDS = ['/agent', '/chat', '/mode', '/model', '/project', '/models', '/last', '/plan', '/clear', '/help', '/exit'];

/** Tab completion for slash commands and @file paths. */
function completer(line) {
  if (line.startsWith('/')) {
    const hits = SLASH_COMMANDS.filter((c) => c.startsWith(line));
    return [hits.length ? hits : SLASH_COMMANDS, line];
  }
  const at = line.lastIndexOf('@');
  if (at >= 0 && !/\s/.test(line.slice(at + 1))) {
    const frag = line.slice(at + 1);
    const slash = frag.lastIndexOf('/');
    const dir = slash >= 0 ? frag.slice(0, slash + 1) : '';
    const base = frag.slice(dir.length);
    try {
      const hits = readdirSync(join(cwd(), dir), { withFileTypes: true })
        .filter((e) => e.name.startsWith(base))
        .map((e) => line.slice(0, at + 1) + dir + e.name + (e.isDirectory() ? '/' : ''));
      return [hits, line];
    } catch { return [[], line]; }
  }
  return [[], line];
}

/** A compact status footer after each agent turn. */
function printStatus(state) {
  const bits = [basename(cwd()), state.model, state.mode, sessionTokens ? `${sessionTokens} tok` : null].filter(Boolean);
  stdout.write(dim(`  ${bits.join('  ·  ')}\n`));
}

/** Ask the user to approve a mutating tool call. Returns 'y' | 'n' | 'a' | { decision, command }. */
async function confirmTool(rl, call, danger, cwd) {
  // Show a colored diff preview for file-mutating tools before asking.
  if (call.name === 'write_file' || call.name === 'edit_file') {
    const change = await computeFileChange(call.name, call.args, cwd);
    if (change && change.before !== change.after) {
      stdout.write(renderDiff(lineDiff(change.before, change.after), { color: useColor }) + '\n');
    }
  }
  const label = `${VERB[call.name] ?? call.name}(${toolDetail(call)})`;
  const warn = danger ? red('⚠ looks destructive — ') : '';
  const opts = call.name === 'run_command' ? '[y]es · [a]lways · [e]dit · [n]o: ' : '[y]es · [a]lways · [n]o: ';
  const ans = (await ask(rl, '  ' + warn + yellow(`${bold(label)} `) + dim(opts))).toLowerCase();
  if (ans.startsWith('a')) return 'a';
  if (ans.startsWith('n')) return 'n';
  if (ans.startsWith('e') && call.name === 'run_command') {
    const edited = await ask(rl, dim('  new command: '));
    return { decision: 'y', command: edited.trim() || call.args.command };
  }
  if (danger && ans !== 'y' && ans !== 'yes') return 'n'; // destructive needs an explicit yes
  return 'y'; // Enter defaults to yes for ordinary actions
}

/**
 * Enter a project: load its saved conversation, create/open its Desktop folder, show it.
 * Mutates `state` with the project id, name, folder dir and loaded messages.
 */
async function enterProject(cfg, state, projectId) {
  const hist = await fetchProjectHistory(cfg, projectId);
  const name = hist?.name ?? projectId;
  state.project = projectId;
  state.projectName = name;
  state.messages = (hist?.messages ?? []).map((m) => ({ role: m.role, content: m.content, provider: m.provider }));
  try {
    state.dir = await ensureProjectFolder(projectId, name);
    console.log(dim(`— ${name} · ${state.messages.length} saved message(s) · folder: ${state.dir} —`));
    await writeTranscript(state.dir, name, state.messages);
  } catch (e) {
    state.dir = null;
    console.log(dim(`— ${name} · ${state.messages.length} saved message(s) (could not create Desktop folder: ${e.message}) —`));
  }
  if (hist) printHistory(hist.messages);
}

async function runChat(parsed) {
  const cfg = resolveConfig(await loadConfigFile(), env);
  if (!cfg.token || !cfg.baseUrl) {
    console.error(red('Not configured. Run `freetoken login` first (you need an ft_ token from the website).'));
    exit(1);
  }
  const model = parsed.model ?? 'auto-smart';
  // Explicit --project, else auto-detect from a project folder we're standing in.
  let project = parsed.project ?? null;
  if (!project) {
    const fromCwd = await projectFromCwd();
    if (fromCwd) project = fromCwd.id;
  }

  const approvals = { all: new Set() };
  if (parsed.auto) { approvals.all.add('run_command'); approvals.all.add('write_file'); }

  // One-shot mode: freetoken "question"
  if (parsed.message) {
    // With --yolo, run it as an unattended agent task; otherwise a plain one-shot answer.
    if (parsed.auto) {
      const servers = new Map();
      const convo = [{ role: 'system', content: agentSystemPrompt(cwd()) }, { role: 'user', content: parsed.message }];
      const result = await runAgentTurn({
        model, messages: convo, cwd: cwd(), approvals, print: agentPrinter,
        complete: makeComplete(cfg),
        confirm: async () => 'a',
        toolDeps: { cfg, servers },
      });
      if (!result.ok) { console.error(red(result.error)); exit(1); }
      return;
    }
    const r = await streamChat(cfg, model, [{ role: 'user', content: parsed.message }], project);
    if (!r.ok) {
      console.error(red(r.error));
      exit(1);
    }
    return;
  }

  const rule = dim('─'.repeat(Math.min(stdout.columns || 64, 64)));
  console.log('\n' + bold(cyan('  ◆ FreeToken Agent')));
  console.log(dim(`  ${cfg.baseUrl}  ·  ${model}  ·  agent mode`));
  console.log(dim('  I can run commands & edit files — you approve each.  /chat · /help'));
  console.log(rule);
  const state = { model, mode: 'agent', approvals, servers: new Map(), messages: [], project: null, projectName: null, dir: null, pending: null };
  if (project) await enterProject(cfg, state, project);
  const rl = createInterface({ input: stdin, output: stdout, prompt: cyan('› '), completer });
  rl.prompt();

  rl.on('line', async (rawLine) => {
    // Multi-line input: a trailing backslash continues onto the next line.
    let line = rawLine;
    if (state.pending != null) {
      if (line.endsWith('\\')) { state.pending += line.slice(0, -1) + '\n'; rl.setPrompt(dim('… ')); rl.prompt(); return; }
      line = state.pending + line; state.pending = null; rl.setPrompt(cyan('› '));
    } else if (line.endsWith('\\')) {
      state.pending = line.slice(0, -1) + '\n'; rl.setPrompt(dim('… ')); rl.prompt(); return;
    }
    rl.pause(); // hold further input until this turn finishes, so replies can't overlap
    const action = applyCommand(line);
    switch (action.type) {
      case 'message': {
        if (!action.text) break;
        const text = expandMentions(action.text, readMention); // inline any @file contents
        if (state.mode === 'agent') {
          await agentExchange(cfg, rl, state, text);
        } else {
          state.messages.push({ role: 'user', content: text });
          const r = await streamChat(cfg, state.model, state.messages, state.project);
          if (r.ok) {
            state.messages.push({ role: 'assistant', content: r.text, provider: r.provider });
            if (state.dir) await writeTranscript(state.dir, state.projectName, state.messages);
          } else {
            state.messages.pop();
            console.error(red(r.error));
          }
        }
        break;
      }
      case 'plan': {
        if (state.mode !== 'agent') { console.log(dim('Plan mode works in agent mode. Use /agent first.')); break; }
        const task = expandMentions(action.task, readMention);
        const stop = startSpinner('planning…');
        const planRes = await agentComplete(cfg, state.model, [
          { role: 'system', content: 'You are a senior engineer. Produce a short numbered plan (3–7 steps) to accomplish the task. Do NOT write code or call tools yet — just the plan.' },
          ...state.messages,
          { role: 'user', content: task },
        ]);
        stop();
        if (!planRes.ok) { console.error(red(planRes.error)); break; }
        stdout.write('\n' + renderMarkdown(planRes.message.content ?? '', { color: useColor }) + '\n');
        const go = (await ask(rl, yellow('Proceed with this plan? ') + dim('[y/N]: '))).toLowerCase();
        if (go.startsWith('y')) await agentExchange(cfg, rl, state, task);
        break;
      }
      case 'clear':
        state.messages = [];
        console.log(dim('Started a new conversation.'));
        break;
      case 'model':
        state.model = action.model;
        console.log(dim(`Model set to ${action.model}.`));
        break;
      case 'project':
        if (action.project) {
          await enterProject(cfg, state, action.project);
        } else {
          state.project = null;
          state.projectName = null;
          state.dir = null;
          state.messages = [];
          console.log(dim('Left project mode.'));
        }
        break;
      case 'mode':
        state.mode = action.mode;
        console.log(dim(action.mode === 'agent'
          ? 'Agent mode — I can run commands & edit files (you approve each).'
          : 'Plain chat mode — no tools.'));
        break;
      case 'last':
        console.log(lastToolOutput || dim('No tool output yet.'));
        break;
      case 'models': {
        const models = await fetchModels(cfg);
        console.log(models.length ? models.map((m) => '  ' + m).join('\n') : dim('No models (connect a provider on the website).'));
        break;
      }
      case 'help':
        printHelp();
        break;
      case 'error':
        console.log(yellow(action.message));
        break;
      case 'exit':
        rl.close();
        return;
    }
    rl.resume();
    rl.prompt();
  });

  let lastSigint = 0;
  rl.on('SIGINT', () => {
    if (activeController) { activeController.abort(); return; } // interrupt the model request only
    if (Date.now() - lastSigint < 1500) { rl.close(); return; } // double Ctrl-C exits
    lastSigint = Date.now();
    state.pending = null;
    stdout.write(dim('\n(^C again to exit)\n'));
    rl.setPrompt(cyan('› '));
    rl.prompt();
  });

  rl.on('close', () => {
    for (const s of state.servers.values()) { try { s.child.kill(); } catch { /* already gone */ } }
    console.log(dim('\nBye.'));
    exit(0);
  });
}

// ---------------------------------------------------------------- run / setup: other AI tools on FreeToken
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'http://localhost:3000/api/v1';

/** The token for `run`: the saved one, or — next to a running FreeToken — sign in on our own, like V-Run. */
async function tokenForRun(baseUrl, saved) {
  if (saved) return saved;
  try {
    const login = (await readFile(join(REPO_ROOT, '.data', 'local-login.token'), 'utf8')).trim();
    const res = await fetch(`${originOfBase(baseUrl)}/api/local/v-run-token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: login, name: 'CLI' }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j?.token) {
      await saveConfigFile({ baseUrl, token: j.token });
      return j.token;
    }
  } catch { /* not running locally */ }
  return null;
}

async function runTool(args) {
  if (!args.length) {
    console.error('Usage: freetoken run <command> [args…]   e.g. freetoken run claude');
    exit(1);
  }
  const cfg = resolveConfig(await loadConfigFile(), env);
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE;
  const token = await tokenForRun(baseUrl, cfg.token);
  if (!token) {
    console.error(red('No FreeToken token yet. Start FreeToken with `npm run dev` (then this signs in by itself), or run `freetoken login`.'));
    exit(1);
  }
  console.error(dim(`◆ ${args[0]} → FreeToken (${originOfBase(baseUrl)}) · free models, model auto-smart`));
  const which = (name) => { try { return execFileSync('where.exe', [name], { encoding: 'utf8' }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean); } catch { return []; } };
  const plan = launchPlan(args[0], args.slice(1), which);
  const child = spawnChild(plan.file, plan.args, { stdio: 'inherit', env: { ...env, ...envFor(baseUrl, token) }, shell: plan.shell });
  // Ctrl+C reaches the tool too (same terminal): Claude Code / Codex / Aider treat it as "interrupt"
  // and keep running. This wrapper must not die under them (leaving the tool orphaned, fighting the
  // shell for the terminal) — it ignores Ctrl+C and exits when the tool does. A real termination
  // request is passed on to the tool.
  for (const sig of ['SIGINT', 'SIGBREAK']) process.on(sig, () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGHUP', () => child.kill('SIGHUP'));
  child.on('error', (e) => { console.error(red(`Couldn't start ${args[0]}: ${e.message}`)); exit(1); });
  // killed by a signal: not a success
  child.on('exit', (code, signal) => exit(code ?? (signal ? 1 : 0)));
}

async function runSetup(args) {
  const cfg = resolveConfig(await loadConfigFile(), env);
  console.log(setupText(args[0], cfg.baseUrl ?? DEFAULT_BASE, cfg.token ? `${cfg.token.slice(0, 7)}… (your saved token)` : '<your ft_ token from FreeToken → API>'));
}

const rawArgs = argv.slice(2);
if (rawArgs[0] === 'run') { await runTool(rawArgs.slice(1)); await new Promise(() => {}); }
if (rawArgs[0] === 'setup') { await runSetup(rawArgs.slice(1)); exit(0); }
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    bold('freetoken') + dim(' — terminal client for your FreeToken app\n') +
      '\nUsage:\n' +
      '  freetoken login                     save your base URL + ft_ token\n' +
      '  freetoken                           interactive agent (runs commands & edits files, you approve)\n' +
      '  freetoken "your question"           one-shot answer (plain chat)\n' +
      '  freetoken --yolo "build me X"       one-shot agent task, auto-approving every tool\n' +
      '  freetoken --project <id>            use a saved project (shared with the web app)\n' +
      '  freetoken -m <model> "question"     pick a model (auto-smart, auto-fast, provider/model)\n' +
      '  freetoken run claude                run Claude Code (or any tool) on your free models\n' +
      '  freetoken setup [tool]              setup for claude-code, codex, cursor, cline, continue, aider, opencode\n',
  );
  printHelp();
  exit(0);
}
const parsed = parseArgs(rawArgs);
if (parsed.command === 'login') await runLogin();
else await runChat(parsed);
