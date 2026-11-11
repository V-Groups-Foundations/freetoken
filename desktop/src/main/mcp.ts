// MCP (Model Context Protocol) servers give the agent more tools — GitHub, a database, a browser, docs —
// the same way Claude Code and Cursor use them. Servers are listed like Claude's config:
//   { "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { … } } } }
// in ~/.v-run/mcp.json (yours: trusted) and in the project's .mcp.json or .v-run/mcp.json (a cloned repo
// could put anything there: started only after the user says yes, once per version of that file).
// Each server runs as a child process speaking JSON-RPC over stdin/stdout; its tools appear to the agent
// as mcp__<server>__<tool>, and every call asks first unless a rule allows it.
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { killTree, windowsShell } from "./runner";

export type ServerConfig = { command: string; args?: string[]; env?: Record<string, string>; cwd?: string };
export type McpTool = { name: string; description: string; input_schema: Record<string, unknown>; server: string; tool: string };
type Server = { name: string; proc: ChildProcess; tools: McpTool[]; pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>; seq: number; buf: string; err: string; dead?: string };

const home = () => process.env.VRUN_HOME || path.join(os.homedir(), ".v-run");
const servers = new Map<string, Server>();
let startedFor: string | null = null;

function readConfig(file: string): Record<string, ServerConfig> {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const s = j?.mcpServers ?? j?.servers ?? {};
    return Object.fromEntries(Object.entries(s).filter(([, v]: [string, any]) => v && typeof v.command === "string")) as Record<string, ServerConfig>;
  } catch { return {}; }
}
export const userConfigFile = () => path.join(home(), "mcp.json");
export const projectConfigFile = (root: string) => [path.join(root, ".mcp.json"), path.join(root, ".v-run", "mcp.json")].find((f) => fs.existsSync(f)) ?? null;

// ---------------------------------------------------------------- trust (project config files)
const trustFile = () => path.join(home(), "trusted.json");
const hashOf = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
/** Whether the user already said yes to this exact project file (a changed file asks again). */
export function isTrusted(file: string) {
  try { return (JSON.parse(fs.readFileSync(trustFile(), "utf8")) as Record<string, string>)[path.resolve(file)] === hashOf(file); } catch { return false; }
}
export function trust(file: string) {
  let all: Record<string, string> = {};
  try { all = JSON.parse(fs.readFileSync(trustFile(), "utf8")); } catch { /* first one */ }
  all[path.resolve(file)] = hashOf(file);
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(trustFile(), JSON.stringify(all, null, 2));
}

// ---------------------------------------------------------------- JSON-RPC over stdio
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
export const toolName = (server: string, tool: string) => `mcp__${safeName(server)}__${safeName(tool)}`.slice(0, 64);
export const isMcpTool = (name: string) => name.startsWith("mcp__");

function request(s: Server, method: string, params: unknown, ms = 60_000): Promise<any> {
  if (s.dead) return Promise.reject(new Error(`MCP server "${s.name}" isn't running (${s.dead}).`));
  const id = ++s.seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.pending.delete(id); reject(new Error(`MCP server "${s.name}" didn't answer ${method} within ${ms / 1000}s.`)); }, ms);
    s.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    s.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
const notify = (s: Server, method: string, params?: unknown) => s.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })}\n`);

async function startServer(name: string, cfg: ServerConfig, root: string): Promise<Server> {
  const win = process.platform === "win32";
  // through the shell, so "npx", "uvx", "python" resolve as they do in a terminal (npx.cmd on Windows)
  const line = [cfg.command, ...(cfg.args ?? [])].map((a) => (win ? `'${a.replace(/'/g, "''")}'` : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
  const proc = spawn(win ? windowsShell() : "/bin/bash", win ? ["-NoProfile", "-NonInteractive", "-Command", `& ${line}`] : ["-lc", `exec ${line}`],
    { cwd: cfg.cwd ? path.resolve(root, cfg.cwd) : root, env: { ...process.env, ...(cfg.env ?? {}) }, windowsHide: true, detached: !win, stdio: ["pipe", "pipe", "pipe"] });
  const s: Server = { name, proc, tools: [], pending: new Map(), seq: 0, buf: "", err: "" };
  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");
  proc.stdout?.on("data", (d: string) => {
    s.buf += d;
    let nl: number;
    while ((nl = s.buf.indexOf("\n")) >= 0) {
      const line = s.buf.slice(0, nl).trim();
      s.buf = s.buf.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; } // a server's stray log line
      if (msg.id !== undefined && s.pending.has(msg.id)) {
        const p = s.pending.get(msg.id)!;
        s.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error))); else p.resolve(msg.result);
      }
    }
  });
  proc.stderr?.on("data", (d: string) => { s.err = (s.err + d).slice(-4000); });
  const died = (why: string) => { s.dead = why; for (const p of s.pending.values()) p.reject(new Error(`MCP server "${name}" stopped: ${why}${s.err ? `\n${s.err.slice(-500)}` : ""}`)); s.pending.clear(); };
  proc.on("error", (e) => died(e.message));
  proc.on("exit", (code) => died(`exited with code ${code}`));
  await request(s, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "V-Run", version: "1.0" } }, 30_000);
  notify(s, "notifications/initialized");
  let cursor: string | undefined;
  do {
    const r = await request(s, "tools/list", cursor ? { cursor } : {}, 30_000);
    for (const t of r?.tools ?? []) s.tools.push({ name: toolName(name, t.name), tool: t.name, server: name, description: `[MCP: ${name}] ${t.description ?? t.name}`.slice(0, 1024), input_schema: t.inputSchema ?? { type: "object", properties: {} } });
    cursor = r?.nextCursor;
  } while (cursor);
  return s;
}

/**
 * Start the MCP servers for this project (once per project): yours, plus the project's own after `askTrust`
 * says yes. Returns what started and what failed, for the chat to show.
 */
export async function ensureStarted(root: string | null, askTrust: (file: string, servers: Record<string, ServerConfig>) => Promise<boolean>) {
  if (!root || startedFor === root) return { started: [] as string[], failed: [] as string[] };
  stopAll();
  startedFor = root;
  const all: Record<string, ServerConfig> = { ...readConfig(userConfigFile()) };
  const projFile = projectConfigFile(root);
  if (projFile) {
    const proj = readConfig(projFile);
    if (Object.keys(proj).length && (isTrusted(projFile) || (await askTrust(projFile, proj)))) { trust(projFile); Object.assign(all, proj); }
  }
  const started: string[] = [], failed: string[] = [];
  await Promise.all(Object.entries(all).map(async ([name, cfg]) => {
    try { servers.set(name, await startServer(name, cfg, root)); started.push(name); }
    catch (e) { failed.push(`${name}: ${(e as Error).message.split("\n")[0]}`); }
  }));
  return { started, failed };
}

export const mcpTools = (): McpTool[] => [...servers.values()].filter((s) => !s.dead).flatMap((s) => s.tools);
export const findTool = (name: string) => mcpTools().find((t) => t.name === name);

/** Call an MCP tool: its text (and the first image, if it returned one). */
export async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; image?: Buffer; isError: boolean }> {
  const t = findTool(name);
  if (!t) throw new Error(`No MCP tool called ${name} is running.`);
  const r = await request(servers.get(t.server)!, "tools/call", { name: t.tool, arguments: args ?? {} }, 120_000);
  const parts = (r?.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string; resource?: { text?: string; uri?: string } }[];
  const text = parts.map((p) => p.type === "text" ? p.text ?? "" : p.type === "resource" ? p.resource?.text ?? p.resource?.uri ?? "" : p.type === "image" ? "[image]" : "").filter(Boolean).join("\n")
    || (r?.structuredContent ? JSON.stringify(r.structuredContent) : "(no content)");
  const img = parts.find((p) => p.type === "image" && p.data);
  return { text: text.slice(0, 60_000), ...(img ? { image: Buffer.from(img.data!, "base64") } : {}), isError: !!r?.isError };
}

export const runningServers = () => [...servers.values()].map((s) => ({ name: s.name, tools: s.tools.length, dead: s.dead ?? null }));

export function stopAll() {
  for (const s of servers.values()) { s.dead ??= "stopped"; killTree(s.proc, true); }
  servers.clear();
  startedFor = null;
}
