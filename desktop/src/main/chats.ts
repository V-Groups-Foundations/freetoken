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
const MAX_BYTES = 8 * 1024 * 1024;

function write(file: string, data: unknown) {
  if (!dir) return;
  const json = JSON.stringify(data);
  if (json.length > MAX_BYTES) return; // a runaway chat isn't worth a giant file
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, file); // never leave a half-written chat behind
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

export const saveAgent = (sid: string, mem: AgentMemory) =>
  dir && write(path.join(dir, `agent-${safe(sid)}.json`), { claude: withoutImages(mem.claude), ft: withoutImages(mem.ft), skills: mem.skills ?? [] });
export const loadAgent = (sid: string) => (dir ? read<AgentMemory>(path.join(dir, `agent-${safe(sid)}.json`)) : null);
