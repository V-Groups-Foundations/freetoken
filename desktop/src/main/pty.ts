// The terminal panel's real terminal: a pseudo-terminal running the user's shell (PowerShell on Windows,
// their login shell elsewhere) in the project folder, drawn by xterm.js in the window. Full-screen and
// interactive programs work (vim, top, prompts without a newline, installers' arrow-key menus), unlike the
// one-process-per-command fallback in terminal.ts, which is used only if the native module can't load.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IPty } from "@lydell/node-pty";
import { getRoot } from "./workspace";

type PtyModule = typeof import("@lydell/node-pty");
let mod: PtyModule | null | undefined;
let loadError = "";
function load(): PtyModule | null {
  if (mod !== undefined) return mod;
  try { mod = require("@lydell/node-pty") as PtyModule; }
  catch (e) { mod = null; loadError = (e as Error).message; }
  return mod;
}
export const available = () => !!load();
export const whyUnavailable = () => (load() ? "" : loadError);

/** The user's shell: PowerShell 7 if installed, else Windows PowerShell; $SHELL (or bash) elsewhere. */
export function shell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const pwsh = spawnSync("where.exe", ["pwsh.exe"], { encoding: "utf8", windowsHide: true }).stdout?.split(/\r?\n/)[0]?.trim();
    return { file: pwsh && fs.existsSync(pwsh) ? pwsh : "powershell.exe", args: ["-NoLogo"] };
  }
  const sh = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : fs.existsSync("/bin/zsh") && process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  return { file: sh, args: ["-l"] };
}

const ptys = new Map<string, IPty>();

/** Starts the shell for terminal `id` (once; again after it exited). Returns false when PTYs aren't available. */
export function open(id: string, cols: number, rows: number, onData: (data: string) => void, onExit: (code: number) => void): boolean {
  const pty = load();
  if (!pty) return false;
  if (ptys.has(id)) { resize(id, cols, rows); return true; }
  const sh = shell();
  const cwd = getRoot() ?? os.homedir();
  const p = pty.spawn(sh.file, sh.args, {
    name: "xterm-256color", cols: clamp(cols, 20, 500), rows: clamp(rows, 4, 200), cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
    env: { ...process.env, TERM_PROGRAM: "V-Run", COLORTERM: "truecolor" } as Record<string, string>,
  });
  ptys.set(id, p);
  p.onData(onData);
  p.onExit(({ exitCode }) => { if (ptys.get(id) === p) ptys.delete(id); onExit(exitCode); });
  return true;
}

export function write(id: string, data: string) { ptys.get(id)?.write(data); }
export function resize(id: string, cols: number, rows: number) { try { ptys.get(id)?.resize(clamp(cols, 20, 500), clamp(rows, 4, 200)); } catch { /* exited */ } }

/** Ends the shell and everything started in it. */
export function kill(id: string) {
  const p = ptys.get(id);
  if (!p) return;
  ptys.delete(id);
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/t", "/f"], { windowsHide: true });
  try { p.kill(); } catch { /* gone */ }
}
export function killAll() { for (const id of [...ptys.keys()]) kill(id); }

/** The shell's folder name, for the panel title. */
export const label = () => path.basename(getRoot() ?? os.homedir());

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));
