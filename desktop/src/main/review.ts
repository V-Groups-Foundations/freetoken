// A second opinion before a task is called done: the strongest model FreeToken has for reasoning reads
// the diff of what the agent changed, against the request, with fresh eyes. The agent reviewing its own
// work (the old way) read back the files it had just written and nearly always said "all good"; a
// different model with no stake in the work catches the slips free models make (a feature asked for
// and left out, ids that don't match, a handler that's never wired up).
import { lineDiff } from "./diff";

export type ReviewIssue = { file: string; line?: number; problem: string; fix?: string };

const SKIP = /(^|\/)(node_modules|\.git|\.v-run|dist|build)\/|\.lock$|package-lock\.json$/i;
// pictures, video and fonts aren't shown, but they're named: told nothing of them, a reviewer reported the
// <img> tags pointing at freshly made photos as "images that don't exist"
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|mp4|webm|mp3|wav|woff2?|ttf|otf|zip|pdf)$/i;

/** The changes as a reviewer reads them: a unified-style diff per file, new files whole, within a budget. */
export async function changesForReview(files: Map<string, string | null>, read: (rel: string) => Promise<string | null>, budget = 60_000): Promise<string> {
  const parts: string[] = [];
  let used = 0;
  for (const [rel, before] of files) {
    if (SKIP.test(rel.replace(/\\/g, "/"))) continue;
    if (BINARY.test(rel)) { parts.push(`--- ${rel} (${before === null ? "new" : "changed"} ${/\.(png|jpe?g|gif|webp|avif|ico)$/i.test(rel) ? "image" : "file"}, binary — exists, not shown)`); continue; }
    const after = await read(rel);
    let part: string;
    if (after === null) part = `--- ${rel} (deleted)`;
    else if (before === null) part = `--- ${rel} (new file)\n${after.split("\n").map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join("\n")}`;
    else {
      const d = lineDiff(before, after, 3);
      if (!d.added && !d.removed) continue;
      part = `--- ${rel} (+${d.added} −${d.removed})\n${d.lines.map((l) => `${l.t === " " ? " " : l.t}${String(l.b ?? l.a ?? "").padStart(4)} ${l.s}`).join("\n")}`;
    }
    if (used + part.length > budget) { parts.push(`--- ${rel} (left out: the diff is too long to review whole)`); continue; }
    used += part.length;
    parts.push(part);
  }
  return parts.join("\n\n");
}

export const REVIEW_SYSTEM = `You are a strict senior engineer reviewing another AI agent's changes before they are shown to the user. You see the user's request and the diff (lines starting with + were added, - removed; numbers are line numbers in the new file).

Report only real defects: something the request asked for that is missing or only a placeholder; code that would fail (a syntax error, an id/class/function/import/path that doesn't match between files, a handler never connected, wrong logic, data that isn't saved or loaded as asked). Do not report style, naming, formatting, comments, or nice-to-haves. Do not invent problems: if you aren't sure from the diff, leave it out.

Answer with JSON only, no other text: {"issues": [{"file": "path", "line": 12, "problem": "what is wrong and why it breaks", "fix": "the change to make"}]} — at most 5 issues, most serious first. If it's all correct: {"issues": []}`;

export function reviewPrompt(request: string, changes: string) {
  return `The user's request:\n"""\n${request.slice(0, 3000)}\n"""\n\nThe agent's changes:\n\n${changes}`;
}

/** The issues in a reviewer's answer; null when it isn't the JSON asked for (then nothing is claimed). */
export function parseReview(answer: string): ReviewIssue[] | null {
  const text = answer.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as { issues?: unknown };
    if (!Array.isArray(j.issues)) return null;
    return j.issues
      .filter((i): i is ReviewIssue => !!i && typeof i === "object" && typeof (i as ReviewIssue).problem === "string" && typeof (i as ReviewIssue).file === "string")
      .slice(0, 5)
      .map((i) => ({ file: i.file, line: Number.isFinite(Number(i.line)) && Number(i.line) > 0 ? Number(i.line) : undefined, problem: i.problem.slice(0, 600), fix: typeof i.fix === "string" ? i.fix.slice(0, 600) : undefined }));
  } catch { return null; }
}

/** What the agent is told: the reviewer's findings, to check (a reviewer can be wrong) and fix. */
export function reviewFindings(issues: ReviewIssue[]) {
  return `A second model reviewed your changes against the request and found:\n${issues.map((i, n) => `${n + 1}. ${i.file}${i.line ? `:${i.line}` : ""} — ${i.problem}${i.fix ? ` Fix: ${i.fix}` : ""}`).join("\n")}\n\nCheck each one in the code (a reviewer can be wrong). Fix the ones that are real, and check the result again if it's a page. Skip the ones that are wrong without mentioning them. If you changed anything, end with a short summary for the user; if nothing needed changing, reply in one line.`;
}
