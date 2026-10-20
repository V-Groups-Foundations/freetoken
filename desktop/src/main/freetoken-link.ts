// V-Run ⇄ FreeToken: continue a FreeToken project in its Desktop folder with the whole conversation,
// write V-Run's turns back so the web app shows them, parse vrun:// links, and start the FreeToken
// server when V-Run lives inside the FreeToken repo (desktop/) and nothing is listening yet.
// No Electron imports here, so it can be unit tested.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ProjectMessage = { role: "user" | "assistant"; content: string; provider?: string | null };
export type FreeTokenProject = { id: string; name: string; model: string; messages: ProjectMessage[]; dir: string; origin: string };

/** http://host:port of a FreeToken base URL (…/api/v1). */
export const originOf = (base: string) => new URL(base).origin;

/** The user's Desktop, following OneDrive redirection (same rule as the FreeToken CLI). */
export function desktopDir(env = process.env) {
  const c = [env.USERPROFILE && path.join(env.USERPROFILE, "Desktop"), env.OneDrive && path.join(env.OneDrive, "Desktop"),
    path.join(os.homedir(), "OneDrive", "Desktop"), path.join(os.homedir(), "Desktop")].filter(Boolean) as string[];
  return c.find((p) => fs.existsSync(p)) ?? path.join(os.homedir(), "Desktop");
}

/** Same folder naming as the CLI, so both open the same Desktop/FreeToken/<name>. */
export function sanitizeFolderName(name: string) {
  const cleaned = String(name ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/^[.\s-]+|[.\s-]+$/g, "").trim();
  return cleaned || "project";
}

export function renderTranscript(name: string, messages: ProjectMessage[]) {
  const lines = [`# ${name}`, "", "_FreeToken project transcript — shared with the web app and V-Run._", ""];
  for (const m of messages) lines.push(`**${m.role === "user" ? "You" : m.provider ?? "assistant"}:** ${m.content}`, "");
  return lines.join("\n");
}

/** vrun://open (just bring V-Run up) or vrun://project/<id>. Anything else is ignored. */
export function parseDeepLink(raw: string): { kind: "open" } | { kind: "project"; id: string } | null {
  if (/^vrun:\/\/open\/?$/i.test(raw.trim())) return { kind: "open" };
  const m = /^vrun:\/\/project\/([\w-]{1,64})\/?$/i.exec(raw.trim());
  return m ? { kind: "project", id: m[1] } : null;
}

async function api(base: string, token: string, route: string, init: RequestInit = {}, fetchImpl = fetch) {
  if (!token) throw new Error("Connect V-Run to FreeToken first (Settings → FreeToken → Sign in with FreeToken).");
  const res = await fetchImpl(`${originOf(base)}${route}`, {
    ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  }).catch((e: Error) => { throw new Error(`Couldn't reach FreeToken at ${originOf(base)} — is it running? (${e.message})`); });
  const j = await res.json().catch(() => null) as any;
  if (res.status === 401) throw new Error("FreeToken didn't accept V-Run's token. Sign in again from Settings → FreeToken.");
  if (res.status === 404) throw new Error("That project doesn't exist in your FreeToken account.");
  if (!res.ok) throw new Error(`FreeToken: ${typeof j?.error === "string" ? j.error : j?.error?.message ?? res.status}`);
  return j;
}

/** Fetch the project + its conversation and set up its Desktop folder (project.json + transcript.md). */
export async function loadProject(base: string, token: string, id: string, opts: { root?: string; fetchImpl?: typeof fetch } = {}): Promise<FreeTokenProject> {
  const j = await api(base, token, `/api/projects/${encodeURIComponent(id)}/messages`, {}, opts.fetchImpl);
  const name = String(j.project?.name ?? id);
  const messages: ProjectMessage[] = (j.messages ?? []).map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content ?? ""), provider: m.provider ?? null }));
  const dir = path.join(opts.root ?? path.join(desktopDir(), "FreeToken"), sanitizeFolderName(name));
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, "project.json"), JSON.stringify({ id, name, baseUrl: base }, null, 2));
  await fs.promises.writeFile(path.join(dir, "transcript.md"), renderTranscript(name, messages)).catch(() => {});
  return { id, name, model: String(j.project?.model ?? "auto-smart"), messages, dir, origin: originOf(base) };
}

/** Append one finished V-Run turn to the project's shared conversation. */
export async function syncTurn(base: string, token: string, id: string, user: string, assistant: string, fetchImpl?: typeof fetch) {
  const messages: ProjectMessage[] = [{ role: "user", content: user }];
  if (assistant.trim()) messages.push({ role: "assistant", content: assistant.trim(), provider: "v-run" });
  await api(base, token, `/api/projects/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ messages }) }, fetchImpl);
}

// ---------------------------------------------------------------- the hub (V-Run's FreeToken tab)

export type HubData = {
  origin: string;
  state: "connected" | "no-token" | "bad-token" | "offline";
  error?: string;
  projects: { id: string; name: string; updatedAt: string | null }[];
  usage: {
    requests: number; tokens: number; remaining: number;
    /** tokens include guesses (provider didn't report counts); remaining is from published limits, not live */
    tokensEstimated: boolean; remainingLive: boolean;
    /** all daily allowances combined (servers without it: null) */
    overall: { used: number; limit: number; limits: number; resetAt: string } | null;
    providers: { id: string; name: string; status: string; requests: number; used: number | null; limit: number | null; models: number }[];
  } | null;
  models: string[];
};

/** Everything the hub shows, fetched with V-Run's token (which never leaves the main process). */
export async function hubData(base: string, token: string, fetchImpl: typeof fetch = fetch): Promise<HubData> {
  const origin = originOf(base);
  const empty = { origin, projects: [], usage: null, models: [] };
  if (!token) return { ...empty, state: "no-token" };
  const [projects, usage, models] = await Promise.allSettled([
    api(base, token, "/api/projects", {}, fetchImpl),
    api(base, token, "/api/usage", {}, fetchImpl),
    api(base, token, "/api/v1/models", {}, fetchImpl),
  ]);
  const failed = [projects, usage, models].find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (projects.status === "rejected") {
    const msg = String(failed?.reason?.message ?? failed?.reason);
    return { ...empty, state: /didn't accept/.test(msg) ? "bad-token" : /reach FreeToken/.test(msg) ? "offline" : "connected", error: msg };
  }
  const u = usage.status === "fulfilled" ? usage.value : null;
  return {
    origin, state: "connected",
    projects: (projects.value as any[]).map((p) => ({ id: String(p.id), name: String(p.name), updatedAt: p.updatedAt ?? null })),
    usage: u ? {
      requests: u.today?.requests ?? 0, tokens: u.today?.tokens ?? 0, tokensEstimated: (u.today?.estimatedTokens ?? 0) > 0,
      // live numbers when providers report them; older servers only send the combined total
      remaining: u.liveRemainingRequests || (u.publishedRemainingRequests ?? u.knownRemainingRequests ?? 0),
      remainingLive: (u.liveRemainingRequests ?? 0) > 0,
      overall: u.overall?.limit > 0 ? { used: u.overall.used, limit: u.overall.limit, limits: u.overall.limits, resetAt: u.overall.resetAt } : null,
      providers: (u.providers ?? []).map((p: any) => ({
        id: String(p.provider), name: String(p.name ?? p.provider), status: String(p.status ?? ""),
        requests: (p.models ?? []).reduce((n: number, m: any) => n + (m.requests ?? 0), 0),
        used: p.account?.used ?? null, limit: p.account?.limit ?? null, models: (p.models ?? []).length,
      })),
    } : null,
    models: models.status === "fulfilled" ? ((models.value as any).data ?? []).map((m: any) => String(m.id)) : [],
  };
}

export async function createProject(base: string, token: string, name: string, fetchImpl?: typeof fetch): Promise<{ id: string; name: string }> {
  const p = await api(base, token, "/api/projects", { method: "POST", body: JSON.stringify({ name }) }, fetchImpl);
  return { id: String(p.id), name: String(p.name) };
}

// ---------------------------------------------------------------- the FreeToken server next door

/** The FreeToken repo when V-Run runs from its desktop/ folder (dist/main → desktop → repo). */
export function serverRoot(fromDir: string) {
  const root = path.resolve(fromDir, "../../..");
  try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name === "free_token" ? root : null; }
  catch { return null; }
}

export async function isUp(origin: string) {
  try { await fetch(origin, { signal: AbortSignal.timeout(2500), redirect: "manual" }); return true; } catch { return false; }
}

let server: ChildProcess | null = null;
/** Start `npm run dev` in the FreeToken repo (once) and wait until it answers. */
export async function ensureServer(origin: string, root: string | null, onLog?: (line: string) => void): Promise<"running" | "started"> {
  if (await isUp(origin)) return "running";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!local || !root) throw new Error(`FreeToken isn't answering at ${origin}. Start it, then try again.`);
  if (!server) {
    const port = new URL(origin).port || "3000";
    server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "--", "--port", port], {
      cwd: root, shell: process.platform === "win32", windowsHide: true, env: { ...process.env, BROWSER: "none", FREETOKEN_NO_OPEN: "1" },
      detached: process.platform !== "win32",
    });
    server.stdout?.on("data", (d) => onLog?.(String(d)));
    server.stderr?.on("data", (d) => onLog?.(String(d)));
    server.on("exit", () => { server = null; });
  }
  for (let i = 0; i < 120; i++) {
    if (await isUp(origin)) return "started";
    if (!server) throw new Error("The FreeToken server stopped while starting. Run `npm run dev` in the FreeToken folder to see why.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("FreeToken is taking too long to start.");
}

/**
 * Connect V-Run to the FreeToken next door with no sign-in: prove we can read its local sign-in token
 * (.data/local-login.token, written by `npm run dev`) and get V-Run's own API token back.
 */
export async function autoConnect(origin: string, root: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let token: string;
  try { token = (await fs.promises.readFile(path.join(root, ".data", "local-login.token"), "utf8")).trim(); } catch { return null; }
  try {
    const res = await fetchImpl(`${origin}/api/local/v-run-token`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => null) as { token?: string } | null;
    return res.ok && j?.token?.startsWith("ft_") ? j.token : null;
  } catch { return null; }
}

/** Stop the server only if V-Run started it. */
export function stopServer() {
  const p = server;
  server = null;
  if (!p?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill(); }
}
