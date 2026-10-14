#!/usr/bin/env node
// FreeToken terminal client. Talks to your FreeToken /api/v1 endpoint with an ft_ token.
// Run:  node bin/freetoken.mjs   (or, once linked, `freetoken`)
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { stdin, stdout, env, argv, exit, chdir, cwd } from 'node:process';
import { resolveConfig, deltaFromLine, parseArgs, applyCommand, sanitizeFolderName, renderTranscript, toApiMessages } from '../src/cli/core.mjs';
import { runAgentTurn, agentSystemPrompt, TOOLS } from '../src/cli/agent.mjs';
import { renderMarkdown } from '../src/cli/render.mjs';

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
const green = (s) => c('32', s);
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
  console.log(green(`Saved to ${CONFIG_PATH}`));
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
      '  /model <id>   switch model (e.g. auto-smart, auto-fast, groq/…)',
      '  /project <id> use a project (shared memory with the web app); blank to leave',
      '  /models       list your available models',
      '  /clear        start a new conversation',
      '  /help         show this help',
      '  /exit         quit',
      '',
      dim('In agent mode: y = run once · a = always allow this tool · n = skip. Start with --yolo to auto-approve.'),
    ].join('\n'),
  );
}

// ---- Agent mode: tool-call loop against /chat/completions (non-streaming) ----

/** One non-streaming completion with tools, for the agent loop. */
async function agentComplete(cfg, model, messages) {
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ model, messages: toApiMessages(messages), tools: TOOLS, stream: false }),
    });
  } catch (e) {
    return { ok: false, error: `Could not reach ${cfg.baseUrl} (${e.message}).` };
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

/** agentComplete wrapped with a thinking spinner, for the agent loop. */
function withSpinner(cfg) {
  return async (model, messages) => {
    const stop = startSpinner('thinking…');
    try {
      return await agentComplete(cfg, model, messages);
    } finally {
      stop();
    }
  };
}

const VERB = { run_command: 'Run', write_file: 'Write', read_file: 'Read', list_dir: 'List' };

function toolDetail(call) {
  const a = call.args ?? {};
  if (call.name === 'run_command') return a.command ?? '';
  if (call.name === 'write_file') return a.path ?? '';
  if (call.name === 'read_file') return a.path ?? '';
  if (call.name === 'list_dir') return a.path ?? '.';
  return '';
}

/** A braille spinner shown while the model thinks (TTY only). Returns a stop() function. */
function startSpinner(label) {
  if (!stdout.isTTY) return () => {};
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => stdout.write('\r' + cyan(frames[i++ % frames.length]) + dim(' ' + label)), 80);
  return () => { clearInterval(timer); stdout.write('\r\x1b[K'); };
}

const agentPrinter = {
  assistant: (text, provider) => {
    stdout.write('\n' + renderMarkdown(text.trimEnd(), { color: useColor }) + '\n');
    if (provider) stdout.write(dim(`  ↳ ${provider}\n`));
  },
  tool: (call, allowed) => {
    const dot = allowed ? green('⏺') : red('⊘');
    stdout.write(`${dot} ${bold(VERB[call.name] ?? call.name)}${dim('(' + toolDetail(call) + ')')}\n`);
  },
  toolResult: (call, result, allowed) => {
    if (!allowed) { stdout.write(dim('  ⎿  skipped\n')); return; }
    const lines = String(result).split('\n');
    const shown = lines.slice(0, 8);
    stdout.write(dim('  ⎿  ' + shown.join('\n     ')) + '\n');
    if (lines.length > shown.length) stdout.write(dim(`     … +${lines.length - shown.length} more lines\n`));
  },
};

/** Ask the user to approve a mutating tool call. Returns 'y' | 'n' | 'a'. */
async function confirmTool(rl, call, danger) {
  const label = `${VERB[call.name] ?? call.name}(${toolDetail(call)})`;
  const warn = danger ? red('⚠ looks destructive — ') : '';
  const ans = (await ask(rl, '  ' + warn + yellow(`${bold(label)} `) + dim('[y]es · [a]lways · [n]o: '))).toLowerCase();
  if (ans.startsWith('a')) return 'a';
  if (ans.startsWith('n')) return 'n';
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
      const convo = [{ role: 'system', content: agentSystemPrompt(cwd()) }, { role: 'user', content: parsed.message }];
      const result = await runAgentTurn({
        model, messages: convo, cwd: cwd(), approvals, print: agentPrinter,
        complete: withSpinner(cfg),
        confirm: async () => 'a',
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
  const state = { model, mode: 'agent', approvals, messages: [], project: null, projectName: null, dir: null };
  if (project) await enterProject(cfg, state, project);
  const rl = createInterface({ input: stdin, output: stdout, prompt: cyan('› ') });
  rl.prompt();

  rl.on('line', async (line) => {
    rl.pause(); // hold further input until this turn finishes, so replies can't overlap
    const action = applyCommand(line);
    switch (action.type) {
      case 'message': {
        if (!action.text) break;
        if (state.mode === 'agent') {
          const convo = [
            { role: 'system', content: agentSystemPrompt(cwd()) },
            ...state.messages,
            { role: 'user', content: action.text },
          ];
          const result = await runAgentTurn({
            model: state.model, messages: convo, cwd: cwd(), approvals: state.approvals, print: agentPrinter,
            complete: withSpinner(cfg),
            confirm: (call, danger) => confirmTool(rl, call, danger),
          });
          if (result.ok) {
            state.messages = result.messages.filter((m) => m.role !== 'system');
            if (result.truncated) console.log(dim('[Stopped after the step limit — ask me to continue if needed.]'));
            if (state.dir) await writeTranscript(state.dir, state.projectName ?? 'session', state.messages);
          } else {
            console.error(red(result.error));
          }
        } else {
          state.messages.push({ role: 'user', content: action.text });
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

  rl.on('close', () => {
    console.log(dim('\nBye.'));
    exit(0);
  });
}

const rawArgs = argv.slice(2);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    bold('freetoken') + dim(' — terminal client for your FreeToken app\n') +
      '\nUsage:\n' +
      '  freetoken login                     save your base URL + ft_ token\n' +
      '  freetoken                           interactive agent (runs commands & edits files, you approve)\n' +
      '  freetoken "your question"           one-shot answer (plain chat)\n' +
      '  freetoken --yolo "build me X"       one-shot agent task, auto-approving every tool\n' +
      '  freetoken --project <id>            use a saved project (shared with the web app)\n' +
      '  freetoken -m <model> "question"     pick a model (auto-smart, auto-fast, provider/model)\n',
  );
  printHelp();
  exit(0);
}
const parsed = parseArgs(rawArgs);
if (parsed.command === 'login') await runLogin();
else await runChat(parsed);
