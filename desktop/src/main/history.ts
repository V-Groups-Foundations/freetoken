// A safety net for everything the agent does: snapshots of the project in a private Git repository
// kept in V-Run's data folder (one per project), pointed at the project as its work tree. The user's own
// Git repository, branches and index are never touched. Snapshots are taken before a task, at each
// finished plan step and after the task; restoring one first snapshots the current state, so a restore
// can be undone too. Without git installed, history is simply off.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let dir: string | null = null;
/** Where the snapshot repositories live (V-Run's userData/history); unset means no history. */
export const setHistoryDir = (d: string | null) => { dir = d; if (d) fs.mkdirSync(d, { recursive: true }); };

export interface Snapshot { id: string; time: number; label: string; files: number }

// never snapshotted: dependencies, build output, caches, other VCS data, V-Run's own uploads/temp
const EXCLUDE = ["node_modules/", ".git/", "dist/", "build/", ".next/", "out/", ".nuxt/", ".svelte-kit/", ".turbo/", ".cache/", ".parcel-cache/",
  "coverage/", ".venv/", "venv/", "env/", "__pycache__/", "*.pyc", "target/", ".gradle/", "android/app/build/", ".idea/", ".DS_Store", "Thumbs.db",
  "*.log", ".v-run/tmp/"];
const MAX_FILE = 20 * 1024 * 1024; // larger files aren't snapshotted

const repoOf = (root: string) => path.join(dir!, `${createHash("sha1").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 16)}.git`);

function git(root: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile("git", ["-c", "core.autocrlf=false", "-c", "core.quotepath=off", "-c", "user.name=V-Run", "-c", "user.email=v-run@localhost",
      "-c", "commit.gpgsign=false", `--git-dir=${repoOf(root)}`, `--work-tree=${root}`, ...args],
      { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout)));
    if (input !== undefined) p.stdin?.end(input);
  });
}

let available: boolean | undefined;
async function hasGit() {
  if (available === undefined) available = await new Promise<boolean>((r) => execFile("git", ["--version"], { windowsHide: true }, (e) => r(!e)));
  return available;
}

async function ensureRepo(root: string) {
  const repo = repoOf(root);
  if (fs.existsSync(path.join(repo, "HEAD"))) return;
  fs.mkdirSync(repo, { recursive: true });
  await git(root, ["init", "--quiet"]);
  fs.mkdirSync(path.join(repo, "info"), { recursive: true });
  fs.writeFileSync(path.join(repo, "info", "exclude"), `${EXCLUDE.join("\n")}\n`);
  fs.writeFileSync(path.join(repo, "v-run-root"), path.resolve(root)); // which project this is, for a human looking around
}

// one operation at a time per project: git's index can't take two writers
const queues = new Map<string, Promise<unknown>>();
function serial<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(root) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(root, next.catch(() => {}));
  return next;
}

/** Big files (over 20 MB) that changed: left out of the snapshot. */
async function bigFiles(root: string) {
  const out = await git(root, ["ls-files", "--others", "--modified", "--exclude-standard", "-z"]);
  return out.split("\0").filter(Boolean).filter((f) => { try { return fs.statSync(path.join(root, f)).size > MAX_FILE; } catch { return false; } });
}

/** Snapshot the project as it is now. Returns the snapshot, or null when nothing changed (or no git). */
export function snapshot(root: string | null, label: string): Promise<Snapshot | null> {
  if (!dir || !root) return Promise.resolve(null);
  return serial(root, async () => {
    if (!(await hasGit())) return null;
    try {
      await ensureRepo(root);
      await git(root, ["add", "-A", "--ignore-errors", "--", "."]).catch(() => {});
      for (const f of await bigFiles(root).catch(() => [])) await git(root, ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", f]).catch(() => {});
      const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "");
      if (head) {
        const changed = (await git(root, ["diff", "--cached", "--name-only", "HEAD"])).trim();
        if (!changed) return null;
      }
      await git(root, ["commit", "--quiet", "--no-verify", "--allow-empty-message", "-m", label.replace(/\s+/g, " ").slice(0, 200)]);
      return (await list(root, 1))[0] ?? null;
    } catch (e) {
      console.error("history snapshot failed", e);
      return null;
    }
  });
}

/** The latest snapshots, newest first. */
export async function list(root: string | null, limit = 50): Promise<Snapshot[]> {
  if (!dir || !root || !(await hasGit()) || !fs.existsSync(path.join(repoOf(root), "HEAD"))) return [];
  const out = await git(root, ["log", `-n${limit}`, "--format=%x1e%H%x1f%ct%x1f%s", "--shortstat"]).catch(() => "");
  return out.split("\x1e").filter((x) => x.trim()).map((rec) => {
    const [head, ...rest] = rec.split("\n");
    const [id, ct, label] = head.split("\x1f");
    const files = Number(/(\d+) files? changed/.exec(rest.join(" "))?.[1] ?? 0);
    return { id, time: Number(ct) * 1000, label, files };
  });
}

/** Files that differ between a snapshot and the project now. */
export async function changedSince(root: string, id: string) {
  await git(root, ["add", "-A", "--ignore-errors", "--", "."]).catch(() => {});
  const out = await git(root, ["diff", "--cached", "--name-status", id]);
  return out.split("\n").filter(Boolean).map((l) => { const [status, ...p] = l.split("\t"); return { status: status[0], path: p.join("\t") }; });
}

/**
 * Put the project back to snapshot `id`: changed and deleted files come back, files created since are
 * removed. The current state is snapshotted first, so this can be undone from the history too.
 */
export function restore(root: string | null, id: string): Promise<{ restored: number; removed: string[]; undo: string | null }> {
  if (!dir || !root) return Promise.reject(new Error("History is off."));
  if (!/^[0-9a-f]{7,40}$/i.test(id)) return Promise.reject(new Error("Not a snapshot id."));
  return snapshot(root, `Before restoring ${id.slice(0, 7)}`).then((undo) => serial(root, async () => {
    const diff = await changedSince(root, id);
    // created since the snapshot → removed; everything else is checked out from it
    const created = diff.filter((d) => d.status === "A").map((d) => d.path);
    for (const f of created) { try { fs.rmSync(path.join(root, f), { force: true }); } catch { /* locked: left */ } }
    await git(root, ["checkout", id, "--", "."]);
    // the restore itself is a new snapshot on top (history only grows, so the one taken before the
    // restore stays reachable and the restore can be undone)
    await git(root, ["add", "-A", "--ignore-errors", "--", "."]).catch(() => {});
    await git(root, ["commit", "--quiet", "--no-verify", "--allow-empty", "-m", `Restored ${id.slice(0, 7)}`]).catch(() => {});
    return { restored: diff.length - created.length, removed: created, undo: undo?.id ?? (await list(root, 2))[1]?.id ?? null };
  }));
}

/** For tests: forget whether git exists. */
export const resetHistoryProbe = () => { available = undefined; };
