// One-click "connect" for the AI tools people already use, done on this computer by the local
// FreeToken server (it runs as the user, so it can write their tool configs):
//   - commands on PATH (`claude-free`, `aider-free`, `codex-free`, and `freetoken` itself) that run
//     the real tool through `freetoken run` — the tool's own settings stay untouched;
//   - a separate `freetoken` profile in Codex's config, a FreeToken model in Continue's config;
//   - Cursor and Cline keep settings other programs can't safely edit: for those we hand over a key and
//     the values to paste, plus a link that opens the app.
// Everything FreeToken writes is marked, so Disconnect removes exactly that and nothing else.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ToolId = 'freetoken' | 'claude-code' | 'aider' | 'codex' | 'continue' | 'cursor' | 'cline';
export interface ToolEnv {
  home: string;
  /** where global commands go (npm's global bin, which is on PATH) */
  binDir: string | null;
  repoRoot: string;
  platform: NodeJS.Platform;
  installed(cmd: string): boolean;
}
export interface ToolStatus {
  id: ToolId; name: string; kind: 'auto' | 'assist';
  installed: boolean | null; connected: boolean;
  /** what to type after connecting */
  command?: string; note?: string; openUrl?: string;
}

const MARK = 'freetoken-shim';
const BLOCK_START = '# >>> FreeToken (added by FreeToken; Disconnect removes this block)';
const BLOCK_END = '# <<< FreeToken';

export function detectEnv(): ToolEnv {
  let binDir: string | null = null;
  try {
    const prefix = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['prefix', '-g'], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true }).trim();
    binDir = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
  } catch { /* npm missing: no global commands */ }
  return {
    home: os.homedir(), binDir, repoRoot: process.cwd(), platform: process.platform,
    installed: (cmd) => {
      try { execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [cmd], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; }
    },
  };
}

// ---------------------------------------------------------------- global commands (shims)

const shimPaths = (env: ToolEnv, name: string) =>
  env.binDir ? (env.platform === 'win32' ? [path.join(env.binDir, `${name}.cmd`), path.join(env.binDir, name)] : [path.join(env.binDir, name)]) : [];

/** A command `name` on PATH that runs `node <repo>/bin/freetoken.mjs <args> …`. */
export function writeShim(env: ToolEnv, name: string, args: string) {
  if (!env.binDir) throw new Error("Couldn't find npm's global folder to add a command to. Is npm installed?");
  mkdirSync(env.binDir, { recursive: true });
  const cli = path.join(env.repoRoot, 'bin', 'freetoken.mjs');
  const sh = `#!/bin/sh\n# ${MARK}\nexec node "${cli.replace(/\\/g, '/')}" ${args} "$@"\n`;
  if (env.platform === 'win32') {
    writeFileSync(path.join(env.binDir, `${name}.cmd`), `@echo off\r\nrem ${MARK}\r\nnode "${cli}" ${args} %*\r\n`);
    writeFileSync(path.join(env.binDir, name), sh); // Git Bash / WSL-style shells on Windows
  } else {
    const p = path.join(env.binDir, name);
    writeFileSync(p, sh);
    chmodSync(p, 0o755);
  }
}
const isOurShim = (p: string) => { try { return readFileSync(p, 'utf8').includes(MARK); } catch { return false; } };
export const hasShim = (env: ToolEnv, name: string) => shimPaths(env, name).some(isOurShim);
export function removeShim(env: ToolEnv, name: string) {
  for (const p of shimPaths(env, name)) if (isOurShim(p)) rmSync(p, { force: true });
}

// ---------------------------------------------------------------- the CLI's own config

const cliConfigPath = (env: ToolEnv) => path.join(env.home, '.freetoken', 'config.json');
function readCliConfig(env: ToolEnv): { baseUrl?: string; token?: string } {
  try { return JSON.parse(readFileSync(cliConfigPath(env), 'utf8')); } catch { return {}; }
}
/** Point the CLI (and every shim) at this server, with this token. */
export function saveCliConfig(env: ToolEnv, baseUrl: string, token: string) {
  mkdirSync(path.dirname(cliConfigPath(env)), { recursive: true });
  writeFileSync(cliConfigPath(env), JSON.stringify({ ...readCliConfig(env), baseUrl, token }, null, 2), { mode: 0o600 });
}
export const cliConfiguredFor = (env: ToolEnv, baseUrl: string) => { const c = readCliConfig(env); return !!c.token && c.baseUrl === baseUrl; };

// ---------------------------------------------------------------- marked blocks in text configs

const backup = (file: string) => { if (existsSync(file) && !existsSync(`${file}.freetoken-backup`)) copyFileSync(file, `${file}.freetoken-backup`); };
export function removeBlock(text: string) {
  const re = new RegExp(`\\n?[ \\t]*${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n?`, 'g');
  return text.replace(re, '\n').replace(/\n{3,}/g, '\n\n');
}

// Codex (0.134+): providers live in config.toml, profiles in their own ~/.codex/<name>.config.toml, and
// custom providers speak the Responses API (wire_api = "responses" — FreeToken serves /v1/responses).
const codexPath = (env: ToolEnv) => path.join(env.home, '.codex', 'config.toml');
const codexProfilePath = (env: ToolEnv) => path.join(env.home, '.codex', 'freetoken.config.toml');
export function codexBlock(baseUrl: string) {
  return `${BLOCK_START}\n[model_providers.freetoken]\nname = "FreeToken"\nbase_url = "${baseUrl}"\nenv_key = "FREETOKEN_API_KEY"\nwire_api = "responses"\n${BLOCK_END}\n`;
}
export const CODEX_PROFILE = `# ${MARK}: the "freetoken" Codex profile (codex --profile freetoken). Disconnect in FreeToken removes it.\nmodel_provider = "freetoken"\nmodel = "auto-smart"\n`;

const continuePath = (env: ToolEnv) => path.join(env.home, '.continue', 'config.yaml');
/** Add a FreeToken model under `models:` in Continue's config.yaml (creating the file if needed). */
export function continueWithFreeToken(existing: string | null, baseUrl: string, token: string) {
  const item = (indent: string) =>
    [`${indent}${BLOCK_START}`, `${indent}- name: FreeToken (auto-smart)`, `${indent}  provider: openai`, `${indent}  model: auto-smart`,
      `${indent}  apiBase: ${baseUrl}`, `${indent}  apiKey: ${token}`, `${indent}${BLOCK_END}`].join('\n');
  if (!existing?.trim()) return `name: My Continue config\nversion: 1.0.0\nschema: v1\nmodels:\n${item('  ')}\n`;
  const text = removeBlock(existing);
  const m = text.match(/^models:[ \t]*\n((?:[ \t]*\n)*)([ \t]*)-/m);
  if (m) return text.replace(/^models:[ \t]*\n/m, `models:\n${item(m[2])}\n`);
  if (/^models:[ \t]*\[\s*\][ \t]*$/m.test(text)) return text.replace(/^models:[ \t]*\[\s*\][ \t]*$/m, `models:\n${item('  ')}`);
  return `${text.replace(/\s*$/, '')}\nmodels:\n${item('  ')}\n`;
}

// ---------------------------------------------------------------- the tools

const read = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

export function toolStatus(env: ToolEnv): ToolStatus[] {
  const codex = read(codexPath(env));
  const cont = read(continuePath(env));
  return [
    { id: 'claude-code', name: 'Claude Code', kind: 'auto', installed: env.installed('claude'), connected: hasShim(env, 'claude-free'), command: 'claude-free',
      note: 'Adds a claude-free command: Claude Code on your free models. Your normal claude command is unchanged.' },
    { id: 'codex', name: 'OpenAI Codex CLI', kind: 'auto', installed: env.installed('codex'), connected: !!codex?.includes('wire_api = "responses"') && existsSync(codexProfilePath(env)) && hasShim(env, 'codex-free'), command: 'codex-free',
      note: 'Adds FreeToken as a provider plus a separate "freetoken" profile (~/.codex/freetoken.config.toml — your default is unchanged) and a codex-free command.' },
    { id: 'aider', name: 'Aider', kind: 'auto', installed: env.installed('aider'), connected: hasShim(env, 'aider-free'), command: 'aider-free',
      note: 'Adds an aider-free command that runs Aider on your free models.' },
    { id: 'continue', name: 'Continue', kind: 'auto', installed: existsSync(path.join(env.home, '.continue')) || null, connected: !!cont?.includes(BLOCK_START),
      note: 'Adds a "FreeToken (auto-smart)" model to ~/.continue/config.yaml (a backup is kept).' },
    { id: 'freetoken', name: 'freetoken command', kind: 'auto', installed: true, connected: env.installed('freetoken') || hasShim(env, 'freetoken'), command: 'freetoken run <tool>',
      note: 'Lets you run any AI tool on FreeToken from any folder: freetoken run <tool>.' },
    { id: 'cursor', name: 'Cursor', kind: 'assist', installed: null, connected: false, openUrl: 'cursor://',
      note: 'Cursor keeps its settings where other programs can\'t safely edit them: get a key, then paste the values in Cursor → Settings → Models. Cursor calls models from its own servers, so it needs FreeToken on a public address (not localhost).' },
    { id: 'cline', name: 'Cline / Roo Code', kind: 'assist', installed: null, connected: false, openUrl: 'vscode:extension/saoudrizwan.claude-dev',
      note: 'Cline keeps its settings in VS Code: get a key, then choose "OpenAI Compatible" and paste the three values.' },
  ];
}

/** Connect a tool. `token` is a fresh ft_ token for it; `baseUrl` this server's …/api/v1. */
export function connectTool(id: ToolId, env: ToolEnv, baseUrl: string, token: string): { message: string; command?: string } {
  const ensureCli = () => {
    saveCliConfig(env, baseUrl, token);
    if (!env.installed('freetoken') && !hasShim(env, 'freetoken')) writeShim(env, 'freetoken', '');
  };
  switch (id) {
    case 'freetoken':
      ensureCli();
      return { message: 'freetoken is ready: run any AI tool on your free models with freetoken run <tool>.', command: 'freetoken run claude' };
    case 'claude-code':
      ensureCli(); writeShim(env, 'claude-free', 'run claude');
      return { message: 'Done. Open a new terminal and type claude-free — Claude Code on your free models.', command: 'claude-free' };
    case 'aider':
      ensureCli(); writeShim(env, 'aider-free', 'run aider --model openai/auto-smart');
      return { message: 'Done. Open a new terminal and type aider-free.', command: 'aider-free' };
    case 'codex': {
      ensureCli();
      const file = codexPath(env);
      mkdirSync(path.dirname(file), { recursive: true });
      backup(file);
      const now = removeBlock(read(file) ?? '').replace(/\s*$/, '');
      writeFileSync(file, `${now ? `${now}\n\n` : ''}${codexBlock(baseUrl)}`);
      writeFileSync(codexProfilePath(env), CODEX_PROFILE);
      writeShim(env, 'codex-free', 'run codex --profile freetoken');
      return { message: 'Done. Open a new terminal and type codex-free (or codex --profile freetoken via freetoken run).', command: 'codex-free' };
    }
    case 'continue': {
      const file = continuePath(env);
      mkdirSync(path.dirname(file), { recursive: true });
      backup(file);
      writeFileSync(file, continueWithFreeToken(read(file), baseUrl, token));
      return { message: 'Done. In Continue, pick "FreeToken (auto-smart)" from the model list (reload VS Code if it doesn\'t show).' };
    }
    default:
      throw new Error(`${id} can't be set up automatically — use "Get a key".`);
  }
}

export function disconnectTool(id: ToolId, env: ToolEnv) {
  switch (id) {
    case 'claude-code': removeShim(env, 'claude-free'); break;
    case 'aider': removeShim(env, 'aider-free'); break;
    case 'freetoken': removeShim(env, 'freetoken'); break;
    case 'codex': {
      removeShim(env, 'codex-free');
      const t = read(codexPath(env));
      if (t) writeFileSync(codexPath(env), removeBlock(t));
      if (read(codexProfilePath(env))?.includes(MARK)) rmSync(codexProfilePath(env), { force: true });
      break;
    }
    case 'continue': {
      const t = read(continuePath(env));
      if (t) writeFileSync(continuePath(env), removeBlock(t));
      break;
    }
    default: break;
  }
}
