// Crash reporting with nothing personal in it. Crashes and unhandled errors are written to a local log
// (userData/crash.log) and — unless the user turned it off in Settings — sent to FreeToken: the app version,
// the OS, what kind of failure and the error with its stack, after removing home folders and user names,
// emails, keys and tokens, URL queries and IP addresses. No code, no prompts, no file contents.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CRASH_URL = "https://freetoken-chi.vercel.app/api/vrun/crash";
type Kind = "main-error" | "rejection" | "renderer-gone" | "child-gone" | "renderer-error";

export function scrub(text: string, home = os.homedir(), user = safeUser()): string {
  let t = text;
  if (home) t = t.split(home).join("~");
  t = t
    .replace(/[A-Za-z]:\\Users\\[^\\\s'"]+/gi, "~")
    .replace(/\/(Users|home)\/[^/\s'"]+/g, "~")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b(ft|sk|re|pk|rk|ghp|gho|xox[bap])[_-][A-Za-z0-9_-]{8,}/g, "<key>")
    .replace(/\b(Bearer|token|key|secret|password)([=:\s]+)\S+/gi, "$1$2<hidden>")
    .replace(/(https?:\/\/[^\s?'"]+)\?[^\s'"]*/g, "$1?…")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\b[A-Fa-f0-9]{32,}\b|[A-Za-z0-9+/]{40,}={0,2}/g, "<long>");
  if (user && user.length >= 3) t = t.split(user).join("<user>");
  return t;
}
function safeUser() { try { return os.userInfo().username; } catch { return ""; } }

type Options = { version: string; logDir: string; enabled: () => boolean; post?: (url: string, body: string) => Promise<unknown> };
let opts: Options | null = null;
const sent = new Set<string>();

/** Records one failure: always to the local log, to FreeToken when allowed (each message once a session, at most 10). */
export function report(kind: Kind, err: unknown) {
  if (!opts) return;
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
  const message = scrub(e.message || String(err)).slice(0, 2000);
  const stack = e.stack ? scrub(e.stack).slice(0, 12_000) : undefined;
  try {
    fs.mkdirSync(opts.logDir, { recursive: true });
    fs.appendFileSync(path.join(opts.logDir, "crash.log"), `${new Date().toISOString()} ${kind} v${opts.version}\n${stack ?? message}\n\n`);
  } catch { /* the log is best effort */ }
  const key = `${kind}:${message}`;
  if (!opts.enabled() || sent.has(key) || sent.size >= 10) return;
  sent.add(key);
  const body = JSON.stringify({ version: opts.version, os: `${process.platform} ${os.release()} ${process.arch}`, kind, message, ...(stack ? { stack } : {}) });
  const post = opts.post ?? ((url: string, b: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: b, signal: AbortSignal.timeout(10_000) }));
  post(CRASH_URL, body).catch(() => {});
}

/** Catches what would otherwise be lost: main-process errors, rejected promises, crashed windows and helpers. */
export function installCrashReporting(app: Electron.App, o: Options) {
  opts = o;
  process.on("uncaughtException", (e) => { console.error(e); report("main-error", e); });
  process.on("unhandledRejection", (e) => { console.error(e); report("rejection", e); });
  app.on("render-process-gone", (_e, _wc, d) => { if (d.reason !== "clean-exit" && d.reason !== "killed") report("renderer-gone", new Error(`Window process gone: ${d.reason} (exit ${d.exitCode})`)); });
  app.on("child-process-gone", (_e, d) => { if (d.reason !== "clean-exit" && d.reason !== "killed") report("child-gone", new Error(`${d.type}${d.name ? ` (${d.name})` : ""} process gone: ${d.reason} (exit ${d.exitCode})`)); });
}
