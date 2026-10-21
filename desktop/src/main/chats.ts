// Chats survive a window reload and an app restart: for each project the last chat's transcript (what
// you see) and the agent's conversation (what it remembers) are saved under V-Run's data folder.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let dir: string | null = null;
/** Where chats are kept (V-Run's userData/chats); unset in tests means nothing is saved. */
export const setChatsDir = (d: string | null) => { dir = d; if (d) fs.mkdirSync(d, { recursive: true }); };

const keyOf = (root: string) => createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 16);
const safe = (sid: string) => sid.replace(/[^\w.-]+/g, "_").slice(0, 120);
const MAX_BYTES = 32 * 1024 * 1024;

function write(file: string, data: unknown) {
  if (!dir) return;
  const json = JSON.stringify(data);
  if (json.length > MAX_BYTES) { console.warn(`not saving ${path.basename(file)}: ${Math.round(json.length / 1e6)} MB`); return; }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, file); // never leave a half-written chat behind
}
// The agent's memory is saved during long tasks, every few steps, and can be megabytes: written off the
// main thread's critical path, one write per file at a time, and only the newest state is kept when
// several saves pile up (the in-between ones would be overwritten anyway).
const writing = new Map<string, { pending: string | null; done: Promise<void> }>();
function writeAsync(file: string, data: unknown): Promise<void> {
  if (!dir) return Promise.resolve();
  const json = JSON.stringify(data);
  if (json.length > MAX_BYTES) { console.warn(`not saving ${path.basename(file)}: ${Math.round(json.length / 1e6)} MB`); return Promise.resolve(); }
  const busy = writing.get(file);
  if (busy) { busy.pending = json; return busy.done; }
  const entry = { pending: json as string | null, done: Promise.resolve() };
  entry.done = (async () => {
    while (entry.pending !== null) {
      const next = entry.pending;
      entry.pending = null;
      const tmp = `${file}.tmp`;
      try { await fs.promises.writeFile(tmp, next); await fs.promises.rename(tmp, file); } // never a half-written file
      catch (e) { console.error(`saving ${path.basename(file)} failed`, e); }
    }
    writing.delete(file);
  })();
  writing.set(file, entry);
  return entry.done;
}

function read<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

// ---------------------------------------------------------------- what the chat panel shows

export interface UiChat { sid: string; mode?: string; items: unknown[]; savedAt?: number }
export const saveUi = (root: string, chat: UiChat) => dir && write(path.join(dir, `ui-${keyOf(root)}.json`), { ...chat, savedAt: Date.now() });
export const loadUi = (root: string) => (dir ? read<UiChat>(path.join(dir, `ui-${keyOf(root)}.json`)) : null);

// ---------------------------------------------------------------- what the agent remembers

export interface AgentMemory { claude?: unknown[]; ft?: unknown[]; skills?: string[] }

/** Images are large and only matter in the turn they were sent: keep a note instead. */
function withoutImages(messages: unknown[] = []) {
  return messages.map((m: any) => {
    if (!Array.isArray(m?.content)) return m;
    const kept = m.content.filter((p: any) => p?.type !== "image" && p?.type !== "image_url");
    if (kept.length === m.content.length) return m;
    const note = { type: "text", text: "(an image was attached here)" };
    return { ...m, content: kept.length ? [...kept, note] : [note] };
  });
}

/** Long tasks pile up big tool outputs: past the newest steps, results over 20k characters are cut for saving. */
function trimmed(messages: unknown[] = [], keepWhole = 40) {
  const cut = (t: string) => (t.length > 20_000 ? `${t.slice(0, 8_000)}\n…(${t.length - 16_000} characters cut when saved)…\n${t.slice(-8_000)}` : t);
  return messages.map((m: any, i) => {
    if (i >= messages.length - keepWhole || !m) return m;
    if (m.role === "tool" && typeof m.content === "string") return { ...m, content: cut(m.content) };
    if (Array.isArray(m.content)) return { ...m, content: m.content.map((p: any) => (p?.type === "tool_result" && typeof p.content === "string" ? { ...p, content: cut(p.content) } : p)) };
    return m;
  });
}

export const saveAgent = (sid: string, mem: AgentMemory): Promise<void> =>
  writeAsync(path.join(dir ?? ".", `agent-${safe(sid)}.json`), { claude: trimmed(withoutImages(mem.claude)), ft: trimmed(withoutImages(mem.ft)), skills: mem.skills ?? [] });
/** A Team-mode chat's team (agents, reports, file ownership), so it comes back after a restart. */
export const saveTeam = (sid: string, team: unknown) => dir && write(path.join(dir, `team-${safe(sid)}.json`), team);
export const loadTeam = <T>(sid: string) => (dir ? read<T>(path.join(dir, `team-${safe(sid)}.json`)) : null);

/** The task a chat is running right now: set when it starts, cleared when it ends. Still there after a
 * restart means V-Run closed (or crashed) mid-task, and the chat offers to resume it. */
export interface RunningTask { text: string; mode: string; startedAt: number }
export const markRunning = (sid: string, task: RunningTask | null) => {
  if (!dir) return;
  const file = path.join(dir, `running-${safe(sid)}.json`);
  if (task) write(file, task);
  else fs.rmSync(file, { force: true });
};
export const loadRunning = (sid: string) => (dir ? read<RunningTask>(path.join(dir, `running-${safe(sid)}.json`)) : null);

export const loadAgent = (sid: string) => (dir ? read<AgentMemory>(path.join(dir, `agent-${safe(sid)}.json`)) : null);
