// Workspace file access. Every path that comes from the renderer or the model is
// resolved against the open folder and rejected if it escapes it.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

let root: string | null = null;
let ignore: IgnoreMatcher = () => false;

// A task can work in its own folder without switching the app's (the model benchmark runs each task
// in a throwaway project while the editor, terminal and chat stay on the user's): everything that
// task starts, however deep, sees this folder instead.
const scoped = new AsyncLocalStorage<{ root: string; ignore: IgnoreMatcher }>();
/** Run `fn` (and everything it starts) with `dir` as the workspace. */
export function withRoot<T>(dir: string, fn: () => T): T {
  const real = fs.realpathSync(path.resolve(dir));
  return scoped.run({ root: real, ignore: loadIgnore(real) }, fn);
}
export const getRoot = () => scoped.getStore()?.root ?? root;
const currentIgnore = () => scoped.getStore()?.ignore ?? ignore;
export function setRoot(dir: string) {
  root = fs.realpathSync(path.resolve(dir));
  ignore = loadIgnore(root);
}
/** Close the folder (back to no project open). */
export function clearRoot() { root = null; ignore = () => false; }
export const reloadIgnore = () => { if (root) ignore = loadIgnore(root); };
export const isIgnored = (rel: string, isDir = false) => {
  const p = rel.split(path.sep).join("/");
  return p.split("/").some((seg) => ALWAYS_HIDDEN.has(seg)) || currentIgnore()(p, isDir);
};

export class PathError extends Error {}

/** Resolve a workspace-relative (or absolute-inside-workspace) path; throws if it escapes the root. */
export function resolveInRoot(p: string): { abs: string; rel: string } {
  const root = getRoot();
  if (!root) throw new PathError("No folder is open");
  // "C:\x\y" and "/home/x" stay absolute (then must be inside root); on Windows a bare
  // leading slash ("/src/a.ts", common in model output) means workspace-relative.
  const driveAbs = process.platform === "win32" ? /^[a-zA-Z]:[\\/]/.test(p) : path.isAbsolute(p);
  const abs = driveAbs ? path.resolve(p) : path.resolve(root, p.replace(/^[/\\]+/, ""));
  const rel = path.relative(root, abs);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new PathError(`Path is outside the workspace: ${p}`);
  // follow symlinks / junctions: the path — or, for a file that doesn't exist yet, the nearest folder
  // above it that does — must really be inside the workspace (a link in the repo pointing at ~/.ssh
  // must not let a new file be written there)
  let existing = abs;
  for (;;) {
    try {
      const realRel = path.relative(root, fs.realpathSync(existing));
      if (realRel === ".." || realRel.startsWith(".." + path.sep) || path.isAbsolute(realRel)) throw new PathError(`Path resolves outside the workspace: ${p}`);
      break;
    } catch (e) {
      if (e instanceof PathError) throw e;
      const up = path.dirname(existing);
      if (up === existing) break;
      existing = up;
    }
  }
  return { abs, rel: rel.split(path.sep).join("/") };
}

export interface Entry { name: string; path: string; dir: boolean }

export async function listDir(rel: string): Promise<Entry[]> {
  const { abs, rel: r } = resolveInRoot(rel || ".");
  const items = await fsp.readdir(abs, { withFileTypes: true });
  return items
    .filter((d) => !ALWAYS_HIDDEN.has(d.name))
    .map((d) => ({ name: d.name, path: r && r !== "." ? `${r}/${d.name}` : d.name, dir: d.isDirectory() }))
    .filter((e) => !isIgnored(e.path, e.dir))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.dir ? -1 : 1));
}

export const MAX_READ = 2_000_000;
export async function readText(rel: string): Promise<string> {
  const { abs } = resolveInRoot(rel);
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new PathError(`${rel} is a directory`);
  if (st.size > MAX_READ) throw new PathError(`${rel} is too large to open (${st.size} bytes)`);
  const buf = await fsp.readFile(abs);
  if (looksBinary(buf)) throw new PathError(`${rel} looks like a binary file`);
  return buf.toString("utf8");
}

export async function writeText(rel: string, text: string) {
  const { abs } = resolveInRoot(rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, text, "utf8");
}

export async function deletePath(rel: string) {
  const { abs, rel: r } = resolveInRoot(rel);
  if (!r || r === ".") throw new PathError("Refusing to delete the workspace root");
  await fsp.rm(abs, { recursive: true, force: false });
}

export async function exists(rel: string) {
  try { await fsp.access(resolveInRoot(rel).abs); return true; } catch { return false; }
}

export function looksBinary(buf: Buffer) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// ---------- .gitignore / .cursorignore ----------
// Cursor honours .cursorignore (hide from AI + index) and .cursorindexingignore (index only).
// We apply .gitignore + .cursorignore to the tree, search and agent; .cursorindexingignore to the index.
export const ALWAYS_HIDDEN = new Set([".git", "node_modules", ".DS_Store"]);
type IgnoreMatcher = (rel: string, isDir: boolean) => boolean;

export function loadIgnore(dir: string, files = [".gitignore", ".cursorignore"]): IgnoreMatcher {
  const rules: { re: RegExp; neg: boolean; dirOnly: boolean }[] = [];
  for (const f of files) {
    let text = "";
    try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    for (let line of text.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith("#")) continue;
      const neg = line.startsWith("!");
      if (neg) line = line.slice(1);
      const dirOnly = line.endsWith("/");
      if (dirOnly) line = line.slice(0, -1);
      const anchored = line.includes("/") && !line.startsWith("**/");
      line = line.replace(/^\//, "");
      const body = line.split("/").map((seg) =>
        seg === "**" ? "(?:.*)" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")).join("/")
        .replace(/\(\?:\.\*\)\//g, "(?:.*/)?");
      rules.push({ re: new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}(?:/.*)?$`), neg, dirOnly });
    }
  }
  return (rel, isDir) => {
    let hit = false;
    for (const r of rules) {
      if (r.dirOnly && !isDir && !rel.includes("/")) continue;
      if (r.re.test(rel)) hit = !r.neg;
    }
    return hit;
  };
}
