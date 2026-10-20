// V.md — V-Run's memory, like CLAUDE.md for Claude Code. Two files, read at the start of every chat:
//   <project>/V.md      what to remember about this project (commit it to share with your team)
//   ~/.v-run/V.md       your personal preferences, for every project
// The agent saves lasting facts with the `remember` tool; in the chat, "# something" saves a note.
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getRoot } from "./workspace";

export type Scope = "project" | "user";
const MAX_CHARS = 12_000; // per file, in the prompt

export const userMemoryPath = () => path.join(process.env.VRUN_HOME || path.join(os.homedir(), ".v-run"), "V.md");
export const projectMemoryPath = () => { const r = getRoot(); return r ? path.join(r, "V.md") : null; };
const pathFor = (scope: Scope) => (scope === "user" ? userMemoryPath() : projectMemoryPath());

const TEMPLATE: Record<Scope, string> = {
  project: "# V.md\n\nV-Run reads this file at the start of every chat in this project. Keep it short and specific.\nRun /init in V-Run's chat to have the agent fill it in.\n\n## Memory\n",
  user: "# My V-Run memory\n\nV-Run reads this at the start of every chat, in every project: your preferences and habits.\n\n## Memory\n",
};

async function read(file: string | null) {
  if (!file) return null;
  try { return await fsp.readFile(file, "utf8"); } catch { return null; }
}

/** Both memory files, ready for the system prompt (empty string when there are none). */
export async function memoryForPrompt() {
  const [proj, user] = await Promise.all([read(projectMemoryPath()), read(userMemoryPath())]);
  const clip = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n…(truncated — keep V.md short)` : s);
  const parts: string[] = [];
  if (user?.trim()) parts.push(`## The user's personal memory (~/.v-run/V.md — applies to every project)\n${clip(user.trim())}`);
  if (proj?.trim()) parts.push(`## Project memory (V.md at the project root)\n${clip(proj.trim())}`);
  return parts.join("\n\n");
}

/**
 * A report of work just done ("Fixed X in 8 files") rather than something worth knowing next time.
 * The agent tends to save these; they clutter V.md and say nothing about how to work on the project.
 */
export function looksLikeChangeLog(text: string) {
  return /^(?:i\s+|we\s+|just\s+)?(?:fixed|added|updated|changed|removed|created|implemented|refactored|renamed|deleted|moved|resolved|built|wrote|rewrote|made|replaced|corrected|completed|finished|edited|converted)\b/i.test(text)
    || /\b(?:were|was|have been|has been|are now|is now)\s+(?:fixed|added|updated|changed|removed|created|corrected|resolved|replaced)\b/i.test(text)
    || /\b(?:fixed|updated|changed|edited|corrected|added|removed) in (?:\d+|all|every|both) (?:\w+ )?(?:files?|places?|pages?)\b/i.test(text)
    || /\b(?:errors?|bugs?|issues?|problems?) (?:were |was |have been |has been )?(?:fixed|resolved|corrected)\b/i.test(text)
    // descriptions of a change just made: "the shop page redesign includes…", "…while preserving existing functionality"
    || /\b(?:redesign|overhaul|revamp|rework|rewrite|makeover)(?:ed)?\b.{0,40}\b(?:includes?|has|adds?|features?|brings?)\b/i.test(text)
    || /\bwhile (?:preserving|keeping|maintaining) (?:all )?(?:the )?existing\b/i.test(text);
}

/** Add one line under "## Memory" (creating the file from a template); exact repeats are skipped. */
export async function remember(fact: string, scope: Scope = "project", { fromAgent = false } = {}) {
  const text = fact.replace(/\s+/g, " ").trim().replace(/^[-*]\s+/, "");
  if (!text) throw new Error("Nothing to remember.");
  if (fromAgent && looksLikeChangeLog(text)) {
    throw new Error("Not saved: that's a record of work just done, and V.md isn't a change log. Save a lasting rule or fact that helps next time instead — e.g. \"Start the site with npm start (serves on port 3000)\" or \"After editing CSS, check every property has a colon\". If nothing lasting was learned, don't save anything.");
  }
  if (text.length > 500) throw new Error("Keep memories to one short line (under 500 characters).");
  const file = pathFor(scope);
  if (!file) throw new Error("Open a folder first — project memory lives in its V.md.");
  let doc = (await read(file)) ?? TEMPLATE[scope];
  const line = `- ${text}`;
  if (doc.split(/\r?\n/).some((l) => l.trim().toLowerCase() === line.toLowerCase())) return { file, added: false, line };
  const eol = doc.includes("\r\n") ? "\r\n" : "\n";
  if (!/^## Memory\s*$/m.test(doc)) doc = `${doc.replace(/\s*$/, "")}${eol}${eol}## Memory${eol}`;
  // append at the end of the Memory section (before the next heading, if any)
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Memory\s*$/.test(l));
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  if (end < 0) end = lines.length;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, line);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, lines.join(eol).replace(/\s*$/, "") + eol);
  return { file, added: true, line };
}

export async function memoryStatus() {
  const info = async (scope: Scope) => {
    const file = pathFor(scope);
    const text = await read(file);
    const entries = text ? text.split(/\r?\n/).filter((l) => /^\s*[-*] /.test(l)).length : 0;
    return { file, exists: text !== null, lines: text ? text.split(/\r?\n/).length : 0, entries };
  };
  return { project: await info("project"), user: await info("user") };
}

/** Make sure the file exists (from the template) so it can be opened for editing. */
export async function ensureMemoryFile(scope: Scope) {
  const file = pathFor(scope);
  if (!file) throw new Error("Open a folder first.");
  if ((await read(file)) === null) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, TEMPLATE[scope]); }
  return file;
}
