// Source control: the project's git status, diffs against the last commit, staging, committing and
// branches — the everyday git, inside V-Run. Plain `git` commands with arguments passed as a list (no
// shell), so a file or branch name can't run anything.
import { execFile } from "node:child_process";
import { getRoot, resolveInRoot } from "./workspace";

export type GitFile = { path: string; staged: string; unstaged: string; untracked: boolean };
export type GitStatus = { repo: true; branch: string; ahead: number; behind: number; upstream: string | null; files: GitFile[] } | { repo: false };

function git(args: string[], opts: { input?: string; max?: number } = {}): Promise<string> {
  const root = getRoot();
  if (!root) return Promise.reject(new Error("Open a folder first."));
  return new Promise((resolve, reject) => {
    const p = execFile("git", ["-c", "core.quotepath=false", ...args], { cwd: root, windowsHide: true, maxBuffer: opts.max ?? 20 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split("\n").slice(0, 6).join("\n")));
      else resolve(stdout);
    });
    if (opts.input !== undefined) p.stdin?.end(opts.input);
  });
}
/** A path inside the project, as git wants it (forward slashes, relative); throws for one outside it. */
const rel = (p: string) => resolveInRoot(p).rel.split("\\").join("/");

export async function status(): Promise<GitStatus> {
  let out: string;
  try { out = await git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]); }
  catch (e) { if (/not a git repository/i.test((e as Error).message)) return { repo: false }; throw e; }
  let branch = "", ahead = 0, behind = 0, upstream: string | null = null;
  const files: GitFile[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i];
    if (l.startsWith("# branch.head ")) branch = l.slice(14);
    else if (l.startsWith("# branch.upstream ")) upstream = l.slice(18);
    else if (l.startsWith("# branch.ab ")) { const m = /\+(\d+) -(\d+)/.exec(l); if (m) { ahead = Number(m[1]); behind = Number(m[2]); } }
    else if (l.startsWith("1 ")) { const f = l.split(" "); files.push({ path: f.slice(8).join(" "), staged: f[1][0], unstaged: f[1][1], untracked: false }); }
    else if (l.startsWith("2 ")) { const f = l.split(" "); files.push({ path: f.slice(9).join(" "), staged: f[1][0], unstaged: f[1][1], untracked: false }); i++; /* the old name follows */ }
    else if (l.startsWith("u ")) { const f = l.split(" "); files.push({ path: f.slice(10).join(" "), staged: "U", unstaged: "U", untracked: false }); }
    else if (l.startsWith("? ")) files.push({ path: l.slice(2), staged: ".", unstaged: "?", untracked: true });
  }
  return { repo: true, branch: branch === "(detached)" ? "detached HEAD" : branch, ahead, behind, upstream, files };
}

/** The file at the last commit ("" for a new file) and as it is now, for the diff view. */
export async function diffPair(path: string): Promise<{ original: string; current: string }> {
  const p = rel(path);
  const original = await git(["show", `HEAD:${p}`]).catch(() => "");
  return { original, current: await readNow(p) };
}
async function readNow(p: string) { const fs = await import("node:fs/promises"); return fs.readFile(resolveInRoot(p).abs, "utf8").catch(() => ""); }

export const stage = async (paths: string[]) => { await git(["add", "--", ...paths.map(rel)]); return true; };
export const unstage = async (paths: string[]) => { await git(["restore", "--staged", "--", ...paths.map(rel)]); return true; };
/** Throw away a file's changes: back to the last commit (an untracked file is deleted). */
export async function discard(path: string, untracked: boolean) {
  const p = rel(path);
  if (untracked) { const fs = await import("node:fs/promises"); await fs.rm(resolveInRoot(p).abs, { force: true }); }
  else await git(["restore", "--staged", "--worktree", "--source=HEAD", "--", p]);
  return true;
}
export async function commit(message: string, all = false) {
  if (!message.trim()) throw new Error("Write a commit message first.");
  if (all) await git(["add", "-A"]);
  await git(["commit", "-F", "-"], { input: message });
  return (await git(["log", "-1", "--format=%h %s"])).trim();
}
export async function branches(): Promise<{ current: string; all: string[] }> {
  const out = await git(["branch", "--format=%(HEAD) %(refname:short)"]);
  const lines = out.split("\n").filter(Boolean);
  return { current: lines.find((l) => l.startsWith("*"))?.slice(2) ?? "", all: lines.map((l) => l.slice(2)) };
}
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*[\s~^:?*[\\])[\w./-]{1,100}(?<!\.lock)(?<![./])$/;
export async function checkout(branch: string, create = false) {
  if (!BRANCH.test(branch)) throw new Error(`"${branch}" isn't a valid branch name.`);
  await git(create ? ["switch", "-c", branch] : ["switch", branch]);
  return true;
}
export const log = async (n = 30) => (await git(["log", `-${Math.min(200, n)}`, "--format=%h%x1f%an%x1f%ar%x1f%s"]).catch(() => "")).split("\n").filter(Boolean)
  .map((l) => { const [hash, author, when, subject] = l.split("\x1f"); return { hash, author, when, subject }; });
export const init = () => git(["init"]).then(() => true);
