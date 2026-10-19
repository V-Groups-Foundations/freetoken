// Runs the user's app inside the editor: one long-lived process (dev server, CLI, bot) whose output
// streams to the App panel, plus an embedded browser for web apps. The agent drives both through
// tools, so it sees what the user sees. Electron-specific preview code lives in main.ts behind
// PreviewHost so this module (and the agent tools) stay testable in plain Node.
import { spawn, type ChildProcess } from "node:child_process";
import { getRoot } from "./workspace";

export type RunEvent =
  | { type: "start"; command: string }
  | { type: "data"; data: string }
  | { type: "url"; url: string }
  | { type: "exit"; code: number | null };

export interface PreviewPage { url: string; title: string; text: string; console: string[]; jpeg?: Buffer }
export interface PreviewHost {
  /** Load url in the preview pane; resolves to an error message if it couldn't load. */
  open(url: string): Promise<string | void>;
  inspect(): Promise<PreviewPage | null>;
}

const MAX_OUT = 400_000;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/[^\s'"<>)\]]*)?/i;
// servers that print only "host:port" ("Started on 0.0.0.0:8501"); a nearby verb keeps a database's
// "connecting to localhost:5432" from being taken for the app
const BARE_RE = /\b(?:listening|running|started|serving|server|available|ready|bound)\b[^\n]{0,40}?\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

let proc: ChildProcess | null = null;
let command = "";
let out = "";
let readPos = 0;
let url: string | undefined;
let exitCode: number | null | undefined;
let listener: (e: RunEvent) => void = () => {};
let host: PreviewHost | null = null;

export const onRunEvent = (fn: (e: RunEvent) => void) => { listener = fn; };
export const setPreviewHost = (h: PreviewHost | null) => { host = h; };
export const previewHost = () => host;

export function appStatus() {
  return { running: !!proc, command, url, exitCode: proc ? undefined : exitCode, output: out.slice(-20_000) };
}

function append(text: string) {
  text = text.replace(ANSI, "").replace(/\r(?!\n)/g, "\n");
  out += text;
  if (out.length > MAX_OUT) { const cut = out.length - MAX_OUT; out = out.slice(cut); readPos = Math.max(0, readPos - cut); }
  listener({ type: "data", data: text });
  if (!url) {
    const m = URL_RE.exec(out);
    const bare = m ? null : BARE_RE.exec(out);
    if (m) url = m[0].replace("0.0.0.0", "localhost").replace(/[.,;:]+$/, "");
    else if (bare) url = `http://localhost:${bare[1]}`;
    if (url) listener({ type: "url", url });
  }
}

export function startApp(cmd: string) {
  const root = getRoot();
  if (!root) throw new Error("Open a folder first");
  stopApp();
  command = cmd; out = ""; readPos = 0; url = undefined; exitCode = undefined;
  const win = process.platform === "win32";
  const p = spawn(win ? "powershell.exe" : "/bin/bash", win ? ["-NoProfile", "-NonInteractive", "-Command", cmd] : ["-lc", cmd], {
    cwd: root,
    // unbuffered output, no colors, and dev servers shouldn't pop open an external browser
    env: { ...process.env, PYTHONUNBUFFERED: "1", FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none" },
    detached: !win,
  });
  proc = p;
  listener({ type: "start", command: cmd });
  p.stdout?.on("data", (d) => append(d.toString()));
  p.stderr?.on("data", (d) => append(d.toString()));
  p.on("error", (e) => append(`\n${e.message}\n`));
  p.on("close", (code) => {
    if (proc !== p) return;
    proc = null; exitCode = code;
    append(`\n[exited with code ${code}]\n`);
    listener({ type: "exit", code });
  });
}

/** Kill the app and everything it spawned (a dev server is usually a grandchild of the shell). */
export function stopApp() {
  const p = proc;
  if (!p?.pid) return false;
  proc = null; exitCode = null;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill(); }
  append("\n[stopped]\n");
  listener({ type: "exit", code: null });
  return true;
}

export function appInput(text: string) {
  if (!proc?.stdin?.writable) throw new Error("The app isn't running (or doesn't read input).");
  proc.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
  append(`> ${text.replace(/\n$/, "")}\n`);
}

/** Output produced since the last call (for the agent). */
export function takeNewOutput(max = 12_000) {
  const fresh = out.slice(readPos);
  readPos = out.length;
  return fresh.length > max ? `…(${fresh.length - max} chars omitted)…\n${fresh.slice(-max)}` : fresh;
}

/** Wait until the app prints a URL, exits, or goes quiet, up to ms. */
export function settle(ms: number, signal?: AbortSignal, stopOnUrl = true): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    let last = out.length, quietSince = Date.now();
    const t = setInterval(() => {
      if (out.length !== last) { last = out.length; quietSince = Date.now(); }
      const quiet = Date.now() - quietSince > 1500 && out.length > 0;
      if (!proc || (stopOnUrl && url) || quiet || signal?.aborted || Date.now() - start > ms) { clearInterval(t); resolve(); }
    }, 100);
  });
}

export function describe(): string {
  const s = appStatus();
  if (!s.command) return "No app has been started.";
  return `${s.running ? "Running" : `Not running (exit code ${s.exitCode ?? "n/a"})`}: ${s.command}${s.url ? `\nURL: ${s.url}` : ""}`;
}
