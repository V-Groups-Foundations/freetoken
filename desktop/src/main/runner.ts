// Runs the user's app inside the editor: one long-lived process (dev server, CLI, bot) whose output
// streams to the App panel, plus an embedded browser for web apps. The agent drives both through
// tools, so it sees what the user sees. Electron-specific preview code lives in main.ts behind
// PreviewHost so this module (and the agent tools) stay testable in plain Node.
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
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
/** `wait`: done before returning (on Windows taskkill otherwise runs after us — too late when quitting). */
export function killTree(p: ChildProcess, wait = false) {
  if (!p.pid) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(p.pid), "/T", "/F"];
    if (wait) spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true, timeout: 5000 });
    else spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
  }
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
  /** Reload the page already shown (no new tab, no layout change); an error message if it couldn't load. */
  reload?(): Promise<string | void>;
  /** Run JavaScript in the page; the result (or the error) as text. */
  evaluate?(script: string): Promise<string>;
  /** Show the page this many CSS pixels wide (a phone: 375), media queries and all; null for normal again. */
  setWidth?(width: number | null): Promise<void>;
}

/**
 * One line of the preview's console as the agent reads it. "Failed to load resource: 404" alone doesn't
 * say what's missing, so the address goes with it; Tailwind's CDN build warns on every page built the way
 * the design brief says to, so that one is a note (not a warning to fix).
 */
export function consoleLine(level: string, message: string, source?: string) {
  const text = message.slice(0, 500);
  if (/cdn\.tailwindcss\.com should not be used in production/i.test(text)) return "[note] Tailwind's CDN build warns about production use: expected for a site built with it, nothing to fix.";
  const where = /^Failed to load resource/i.test(text) && source && !text.includes(source) ? ` — ${source.slice(0, 200)}` : "";
  return `[${level}] ${text}${where}`;
}

/** Page-side: how wide the page really is at this width, and what sticks out past the right edge. */
export const OVERFLOW_PROBE = `(() => { const w = innerWidth, page = document.documentElement.scrollWidth;
  const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : "");
  const over = page > w ? [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; })
    .filter((e, _i, all) => !all.some((p) => p !== e && p.contains(e))).slice(0, 6).map((e) => name(e) + " (to " + Math.round(e.getBoundingClientRect().right) + "px)") : [];
  return JSON.stringify({ width: w, pageWidth: page, sticksOut: over }); })()`;

/**
 * Page-side wrapper for the agent's probe script: evaluates it (await allowed), and turns the value into
 * readable text — three.js objects and DOM nodes are cyclic and huge, so it's depth- and size-limited.
 */
export function probeScript(script: string) {
  return `(async () => {
    const show = (v, depth = 0, seen = new WeakSet()) => {
      if (v === null || typeof v !== "object") return typeof v === "function" ? "[function " + (v.name || "anonymous") + "]" : v;
      if (seen.has(v)) return "[circular]";
      seen.add(v);
      if (v instanceof Element) { const r = v.getBoundingClientRect(); return "<" + v.tagName.toLowerCase() + (v.id ? "#" + v.id : "") + "> " + Math.round(r.width) + "x" + Math.round(r.height) + " at " + Math.round(r.x) + "," + Math.round(r.y); }
      if (depth > 3) return Array.isArray(v) ? "[array(" + v.length + ")]" : "[" + (v.constructor && v.constructor.name || "object") + "]";
      if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v).slice(0, 30).map((x) => show(x, depth + 1, seen));
      const out = {};
      for (const k of Object.keys(v).slice(0, 40)) { try { out[k] = show(v[k], depth + 1, seen); } catch (e) { out[k] = "[unreadable]"; } }
      return out;
    };
    // helpers for scripts: setting input.value directly never reaches React/Vue (they track the value
    // through the native setter), so "typing" that way silently did nothing and the agent decided its
    // add-task feature was broken. type() sets it the way a real keystroke does; wait() lets the page update
    if (!globalThis.type) {
      globalThis.wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
      globalThis.type = (target, text) => {
        const el = typeof target === "string" ? document.querySelector(target) : target;
        if (!el) throw new Error("type(): nothing matches " + target);
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(text));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el;
      };
    }
    try {
      // "await …" isn't valid in a plain eval: run it as an async expression, then as async statements
      const run = async (src) => {
        try { return await (0, eval)(src); }
        catch (e) {
          if (!(e instanceof SyntaxError) || !/await/.test(String(e.message))) throw e;
          try { return await (0, eval)("(async () => (" + src + "\\n))()"); }
          catch (e2) { if (!(e2 instanceof SyntaxError)) throw e2; }
          // statements with await: the value of the last expression is the answer ("click(); await wait();
          // list.length" came back undefined). Find where that expression starts, from the end up: a split
          // that doesn't parse fails before anything runs, so trying is safe
          const body = src.replace(/[\\s;]+$/, "");
          const cuts = [];
          for (let i = body.length - 1; i >= 0 && cuts.length < 60; i--) if (body[i] === ";" || body[i] === "\\n") cuts.push(i);
          for (const at of cuts) {
            const last = body.slice(at + 1).trim();
            if (!last || /^(?:(?:const|let|var|if|for|while|do|switch|try|return|throw|function|class|import|export|else|catch|finally)(?![\\w$])|\\}|\\/\\/)/.test(last)) continue;
            try { return await (0, eval)("(async () => {" + body.slice(0, at + 1) + "\\nreturn (" + last + "\\n)})()"); }
            catch (e3) { if (!(e3 instanceof SyntaxError)) throw e3; }
          }
          return await (0, eval)("(async () => {" + src + "\\n})()");
        }
      };
      const value = await run(${JSON.stringify(script)});
      const text = JSON.stringify(show(value), null, 1);
      return text === undefined ? String(value) : text.length > 6000 ? text.slice(0, 6000) + "…(cut)" : text;
    } catch (e) { return "Error: " + (e && e.message || e); }
  })()`;
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

// servers kept running alongside the current app (a frontend and its backend)
interface Background { proc: ChildProcess; command: string; url: string; out: string; exited?: number | null }
const background: Background[] = [];
const MAX_BACKGROUND = 2;
const portOfUrl = (u?: string) => { try { return u ? Number(new URL(u).port) || null : null; } catch { return null; } };
/** The port a command asks for ("-p 5173", "--port=3001", "-l 5173", "PORT=3001", "http.server 8000"). */
export function commandPort(cmd: string) {
  const m = cmd.match(/(?:-p|--port|-l|--listen)[ =](?:tcp:\/\/[^:\s]+:)?(\d{2,5})\b|PORT=(\d{2,5})\b|http\.server\s+(\d{2,5})\b|:(\d{2,5})\b/i);
  return m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : null;
}
function stopBackground(b: Background) {
  background.splice(background.indexOf(b), 1);
  if (b.exited !== undefined) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000);
    b.proc.once("close", () => { clearTimeout(timer); setTimeout(resolve, 300); });
    killTree(b.proc);
  });
}

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
    stopCurrent();
  });
}

// Ports the agent must never take over or kill: FreeToken, which the agent itself runs on (an agent that
// started `npx serve . -p 3000`, was told the port was busy and stopped "that process" took down its own
// AI connection, and every request after that hit a static file server).
let protectedPorts: () => { port: number; name: string }[] = () => [];
export const setProtectedPorts = (fn: typeof protectedPorts) => { protectedPorts = fn; };
export const protectedPort = (port: number) => protectedPorts().find((p) => p.port === port);

/** A command that would use, free up or kill a protected port: why it's refused (null when fine). */
export async function guardCommand(cmd: string): Promise<string | null> {
  const ports = protectedPorts();
  if (!ports.length) return null;
  const c = cmd.toLowerCase();
  const why = (p: { port: number; name: string }) =>
    `Refused: port ${p.port} is ${p.name}, the AI service this agent is running on — stopping it or putting another server on that port cuts off the agent. Use a different port (e.g. npx serve . -p 5173), and never stop ${p.name}.`;
  // stopping every node process takes FreeToken (and V-Run's own helpers) down with it
  // (flags may sit anywhere: Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force)
  if (/taskkill\b[^\n]*\/im\s+"?node|stop-process\b[^\n]*-name\s+"?node\b|\b(killall|pkill)\s+(-\w+\s+)*node\b|\b(get-process|gps|ps)\b[^|\n]*\bnode\b[^|\n]*\|\s*(stop-process|spps|kill)\b/.test(c))
    return why(ports[0]);
  for (const p of ports) {
    const n = String(p.port);
    const mentions = new RegExp(`(?:^|[^\\d])${n}(?!\\d)`).test(c);
    if (!mentions) continue;
    // serving on it, or freeing it (kill-port, fuser -k, "netstat … 3000 … taskkill")
    if (new RegExp(`(-p|--port|-l|--listen|port=|port\\s+|:)\\s*${n}(?!\\d)`).test(c) || /kill|stop-process|fuser/.test(c)) return why(p);
    // servers that take the port as a plain argument: python -m http.server 3000
    if (/http\.server|simplehttpserver/.test(c)) return why(p);
  }
  // killing a PID: refuse it when that PID holds a protected port
  const pids = [...c.matchAll(/(?:\/pid|-id|\bkill(?:\s+-\d+|\s+-9)?)\s+(\d{2,7})/g)].map((m) => Number(m[1]));
  if (pids.length) for (const p of ports) {
    const owner = await portOwner(p.port);
    if (owner && pids.includes(owner.pid)) return why(p);
  }
  return null;
}

/** "EADDRINUSE … :3000" / "port 5173 is already in use" → 3000 / 5173. */
export function portInUse(output: string) {
  const m = output.match(/EADDRINUSE[^\n]*?:(\d{2,5})|address already in use[^\n]*?:(\d{2,5})|port (\d{2,5}) is (?:already )?in use|(\d{2,5}) is already in use/i);
  return m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : null;
}

/** What a port is serving, in a few words ("page \"Shop\"", "HTTP 404"), or null when nothing answers HTTP. */
export async function whatServes(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2500), redirect: "follow" });
    const body = (await res.text()).slice(0, 20_000);
    const title = body.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim();
    if (title) return `a page titled "${title}"`;
    const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return `HTTP ${res.status}${text ? ` ("${text}")` : ""}`;
  } catch {
    return null;
  }
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
  // a running server with an address (say the frontend) keeps running when a different command (the
  // backend) starts: an app is often two servers. Same command or same port: that one is replaced.
  const wantPort = commandPort(cmd);
  for (const b of [...background]) if (b.command === cmd || (wantPort && portOfUrl(b.url) === wantPort)) await stopBackground(b);
  if (proc && command !== cmd && url && portOfUrl(url) !== wantPort) {
    background.push({ proc, command, url, out: out.slice(-20_000) });
    proc = null;
    while (background.length > MAX_BACKGROUND) await stopBackground(background[0]);
  }
  await stopAppAndWait();
  command = cmd; out = ""; readPos = 0; url = undefined; exitCode = undefined;
  const win = process.platform === "win32";
  const p = spawn(win ? windowsShell() : "/bin/bash", win ? ["-NoProfile", "-NonInteractive", "-Command", cmd] : ["-lc", cmd], {
    cwd: root,
    // unbuffered output, no colors, and dev servers shouldn't pop open an external browser
    env: { ...process.env, PYTHONUNBUFFERED: "1", FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none" },
    // no console window popping up on Windows for every app V-Run runs (its output is in the App panel)
    windowsHide: true,
    detached: !win,
  });
  proc = p;
  listener({ type: "start", command: cmd });
  // output goes to the App panel while this is the current app, to its own buffer once it runs alongside
  const sink = (text: string) => {
    if (proc === p) return append(text);
    const b = background.find((x) => x.proc === p);
    if (b) b.out = (b.out + text.replace(ANSI, "")).slice(-20_000);
  };
  p.stdout?.on("data", (d) => sink(d.toString()));
  p.stderr?.on("data", (d) => sink(d.toString()));
  p.on("error", (e) => sink(`\n${e.message}\n`));
  p.on("close", (code) => {
    const b = background.find((x) => x.proc === p);
    if (b) { b.exited = code; return; }
    if (proc !== p) return;
    proc = null; exitCode = code;
    append(`\n[exited with code ${code}]\n`);
    listener({ type: "exit", code });
  });
}

/** Stop every app: the current one and any running alongside it (Stop button, stop_app, quitting). */
export function stopApp() {
  const others = background.splice(0);
  for (const b of others) if (b.exited === undefined) killTree(b.proc);
  return stopCurrent() || others.length > 0;
}

/** Kill the current app and everything it spawned (a dev server is usually a grandchild of the shell). */
function stopCurrent() {
  const p = proc;
  if (!p?.pid) return false;
  proc = null; exitCode = null;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
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
  const also = background.map((b) => `\nAlso ${b.exited === undefined ? "running" : `stopped (exit code ${b.exited ?? "n/a"})`}: ${b.command} — ${b.url}${b.exited === undefined ? "" : `\n  last output: ${b.out.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`}`).join("");
  if (!s.command) return `No app has been started.${also}`;
  return `${s.running ? "Running" : `Not running (exit code ${s.exitCode ?? "n/a"})`}: ${s.command}${s.url ? `\nURL: ${s.url}` : ""}${also}`;
}

/** The apps running alongside the current one (e.g. the backend while the frontend is shown). */
export const otherApps = () => background.map((b) => ({ command: b.command, url: b.url, running: b.exited === undefined }));
