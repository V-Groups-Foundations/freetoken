import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectTool, continueWithFreeToken, disconnectTool, removeBlock, toolStatus, type ToolEnv } from '@/server/tools-connect';

const BASE = 'http://localhost:3000/api/v1';
let env: ToolEnv;
beforeEach(() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ft-tools-'));
  env = { home: path.join(root, 'home'), binDir: path.join(root, 'bin'), repoRoot: path.join(root, 'repo'), platform: 'win32', installed: (c) => c === 'claude' };
  mkdirSync(env.home, { recursive: true });
});

describe('connecting tools', () => {
  it('Claude Code: a claude-free command (cmd + sh) and the CLI config; disconnect removes only ours', () => {
    const r = connectTool('claude-code', env, BASE, 'ft_tok');
    expect(r.command).toBe('claude-free');
    const cmd = readFileSync(path.join(env.binDir!, 'claude-free.cmd'), 'utf8');
    expect(cmd).toContain('freetoken.mjs" run claude %*');
    expect(readFileSync(path.join(env.binDir!, 'claude-free'), 'utf8')).toContain('run claude "$@"');
    expect(JSON.parse(readFileSync(path.join(env.home, '.freetoken', 'config.json'), 'utf8'))).toEqual({ baseUrl: BASE, token: 'ft_tok' });
    expect(existsSync(path.join(env.binDir!, 'freetoken.cmd'))).toBe(true); // `freetoken` wasn't installed, so it was added
    expect(toolStatus(env).find((t) => t.id === 'claude-code')).toMatchObject({ installed: true, connected: true });

    writeFileSync(path.join(env.binDir!, 'aider-free.cmd'), '@echo off\r\nsomeone else\r\n');
    disconnectTool('claude-code', env);
    disconnectTool('aider', env);
    expect(existsSync(path.join(env.binDir!, 'claude-free.cmd'))).toBe(false);
    expect(existsSync(path.join(env.binDir!, 'aider-free.cmd'))).toBe(true); // not ours: left alone
  });

  it('Codex: adds a separate profile, keeps existing settings, reconnects without duplicating, disconnect restores', () => {
    mkdirSync(path.join(env.home, '.codex'));
    const file = path.join(env.home, '.codex', 'config.toml');
    writeFileSync(file, 'model = "o4-mini"\n\n[profiles.work]\nmodel = "gpt-5"\n');
    connectTool('codex', env, BASE, 'ft_tok');
    connectTool('codex', env, BASE, 'ft_tok');
    const t = readFileSync(file, 'utf8');
    expect(t.startsWith('model = "o4-mini"')).toBe(true);
    expect(t.match(/\[model_providers\.freetoken\]/g)).toHaveLength(1);
    expect(t).toContain('wire_api = "responses"'); // Codex dropped "chat"
    expect(t).not.toContain('[profiles.freetoken]'); // profiles have their own file now
    const profile = path.join(env.home, '.codex', 'freetoken.config.toml');
    expect(readFileSync(profile, 'utf8')).toContain('model_provider = "freetoken"');
    expect(existsSync(`${file}.freetoken-backup`)).toBe(true);
    expect(toolStatus(env).find((x) => x.id === 'codex')?.connected).toBe(true);
    disconnectTool('codex', env);
    const back = readFileSync(file, 'utf8');
    expect(back).not.toContain('freetoken');
    expect(back).toContain('[profiles.work]');
    expect(existsSync(profile)).toBe(false);
  });

  it('Continue: inserts a model with the right indentation, or creates the config', () => {
    const created = continueWithFreeToken(null, BASE, 'ft_tok');
    expect(created).toContain('models:\n  # >>> FreeToken');
    expect(created).toContain('  - name: FreeToken (auto-smart)\n    provider: openai');
    const existing = 'name: mine\nmodels:\n    - name: Llama\n      provider: ollama\n';
    const merged = continueWithFreeToken(existing, BASE, 'ft_tok');
    expect(merged).toContain('models:\n    # >>> FreeToken');
    expect(merged).toContain('    - name: FreeToken (auto-smart)');
    expect(merged).toContain('    - name: Llama');
    expect(removeBlock(merged).replace(/\n+/g, '\n')).toBe(existing.replace(/\n+/g, '\n'));
    expect(continueWithFreeToken(merged, BASE, 'ft_new').match(/FreeToken \(auto-smart\)/g)).toHaveLength(1);
  });

  it('on macOS/Linux the command is one executable script', () => {
    env = { ...env, platform: 'linux' };
    connectTool('aider', env, BASE, 'ft_tok');
    expect(existsSync(path.join(env.binDir!, 'aider-free.cmd'))).toBe(false);
    expect(readFileSync(path.join(env.binDir!, 'aider-free'), 'utf8')).toContain('run aider --model openai/auto-smart "$@"');
  });

  it("Cursor and Cline aren't edited automatically", () => {
    expect(() => connectTool('cursor', env, BASE, 'ft_tok')).toThrow(/Get a key/);
    expect(toolStatus(env).filter((t) => t.kind === 'assist').map((t) => t.id)).toEqual(['cursor', 'cline']);
  });
});
