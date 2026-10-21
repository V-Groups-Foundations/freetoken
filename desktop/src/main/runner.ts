// Runs the user's app inside the editor: one long-lived process (dev server, CLI, bot) whose output
// streams to the App panel, plus an embedded browser for web apps. The agent drives both through
// tools, so it sees what the user sees. Electron-specific preview code lives in main.ts behind
// PreviewHost so this module (and the agent tools) stay testable in plain Node.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { getRoot } from "./workspace";

// PowerShell 7 (pwsh) understands && and || like bash; Windows PowerShell 5.1 rejects them, which is
// the first thing models write. Use pwsh when it's installed.
let pwsh: string | null | undefined;
export function windowsShell() {
  if (pwsh === undefined) {
    try { pwsh = execFileSync("where.exe", ["pwsh"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/)[0].trim() || null; }
    catch { pwsh = null; }
  }
  return pwsh ?? "powershell.exe";
}
export const usingPwsh = () => process.platform === "win32" && windowsShell() !== "powershell.exe";

/** Kill a process and everything it started (a server is usually a grandchild of the shell). */
export function killTree(p: ChildProcess) {
  if (!p.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
}

/** Commands that keep running (servers, watchers): they belong in the App panel, not a terminal call. */
export const LONG_RUNNING = /(\bhttp\.server\b|SimpleHTTPServer|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\bnpx\s+(serve|http-server|live-server|vite(?!\s+build))\b|\bnext\s+(dev|start)\b|\bvite(\s+(dev|serve|preview))?\s*$|\b(uvicorn|gunicorn|hypercorn)\b|\bflask\s+run\b|\bstreamlit\s+run\b|manage\.py\s+runserver|\bphp\s+-S\b|\brails\s+s(erver)?\b|\b(http-server|live-server)\b|\bnodemon\b|\bnode\s+\S*(server|app|index|main)\.[cm]?[jt]s\s*$)/i;

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
    // "all interfaces" addresses (0.0.0.0, [::]) aren't something a browser can open: use localhost
    if (m) url = m[0].replace(/0\.0\.0\.0|\[::\]/, "localhost").replace(/[.,;:]+$/, "");
    else if (bare) url = `http://localhost:${bare[1]}`;
    if (url) listener({ type: "url", url });
  }
}

/** Stop the app and wait (up to `ms`) until it has really exited — so the next one gets its port. */
export function stopAppAndWait(ms = 5000) {
  const p = proc;
  if (!p?.pid) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.once("close", () => { clearTimeout(timer); setTimeout(resolve, 300); }); // the OS frees the port a moment later
    stopApp();
  });
}

/** "EADDRINUSE … :3000" / "port 5173 is already in use" → 3000 / 5173. */
export function portInUse(output: string) {
  const m = output.match(/EADDRINUSE[^\n]*?:(\d{2,5})|address already in use[^\n]*?:(\d{2,5})|port (\d{2,5}) is (?:already )?in use|(\d{2,5}) is already in use/i);
  return m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : null;
}

/** Which program holds a TCP port (Windows: netstat + tasklist; elsewhere: lsof). */
export function portOwner(port: number): Promise<{ pid: number; name: string } | null> {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const p = spawn(win ? "netstat" : "lsof", win ? ["-ano", "-p", "tcp"] : ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { windowsHide: true });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", () => {
      if (!win) {
        const pid = Number(out.match(/^p(\d+)/m)?.[1]);
        return resolve(pid ? { pid, name: out.match(/^c(.+)$/m)?.[1] ?? "?" } : null);
      }
      const line = out.split(/\r?\n/).find((l) => new RegExp(`:${port}\\s+\\S+\\s+LISTENING`, "i").test(l));
      const pid = Number(line?.trim().split(/\s+/).pop());
      if (!pid) return resolve(null);
      const t = spawn("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true });
      let name = "";
      t.stdout?.on("data", (d) => (name += d));
      t.on("close", () => resolve({ pid, name: name.split(",")[0]?.replace(/"/g, "").trim() || "?" }));
      t.on("error", () => resolve({ pid, name: "?" }));
    });
  });
}

export async function startApp(cmd: string) {
  const root = getRoot();
  if (!root) throw new Error("Open a folder first");
  await stopAppAndWait();
  command = cmd; out = ""; readPos = 0; url = undefined; exitCode = undefined;
  const win = process.platform === "win32";
  const p = spawn(win ? windowsShell() : "/bin/bash", win ? ["-NoProfile", "-NonInteractive", "-Command", cmd] : ["-lc", cmd], {
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
