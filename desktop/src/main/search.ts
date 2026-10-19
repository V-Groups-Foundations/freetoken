// ripgrep-backed search (Cursor ships RIPGREP_SEARCH / FILE_SEARCH as client-side tools).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getRoot, isIgnored } from "./workspace";

function rgPath() {
  const pkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  const bin = process.platform === "win32" ? "rg.exe" : "rg";
  return require.resolve(`${pkg}/bin/${bin}`).replace("app.asar", "app.asar.unpacked");
}

function rg(args: string[], limitLines: number): Promise<string[]> {
  const root = getRoot();
  if (!root) return Promise.reject(new Error("No folder is open"));
  const extra = fs.existsSync(path.join(root, ".cursorignore")) ? ["--ignore-file", ".cursorignore"] : [];
  return new Promise((resolve, reject) => {
    // --no-require-git: honour .gitignore even when the folder isn't a git repo
    const p = spawn(rgPath(), [...extra, "--no-require-git", "--hidden", "--glob", "!.git", "--glob", "!node_modules", ...args], { cwd: root });
    const lines: string[] = [];
    let buf = "";
    let err = "";
    p.stdout.on("data", (d) => {
      buf += d;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop()!;
      for (const l of parts) { if (lines.length < limitLines) lines.push(l); else { p.kill(); break; } }
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (buf && lines.length < limitLines) lines.push(buf);
      // rg exits 1 when nothing matched; 2 on error
      if (code === 2 && !lines.length) reject(new Error(err.trim() || "ripgrep failed"));
      else resolve(lines);
    });
  });
}

export interface GrepHit { path: string; line: number; text: string }

export async function grep(pattern: string, opts: { glob?: string; caseSensitive?: boolean; fixed?: boolean; max?: number } = {}) {
  const max = opts.max ?? 200;
  const args = ["--line-number", "--no-heading", "--color", "never", "--max-columns", "300", "--max-columns-preview"];
  if (!opts.caseSensitive) args.push("--smart-case");
  if (opts.fixed) args.push("--fixed-strings");
  if (opts.glob) args.push("--glob", opts.glob);
  args.push("--regexp", pattern, ".");
  const lines = await rg(args, max);
  const hits: GrepHit[] = [];
  for (const l of lines) {
    const m = l.match(/^(.*?):(\d+):(.*)$/);
    if (!m) continue;
    const p = m[1].replace(/^\.[\\/]/, "").split(path.sep).join("/");
    if (!isIgnored(p)) hits.push({ path: p, line: Number(m[2]), text: m[3] });
  }
  return { hits, truncated: lines.length >= max };
}

export async function listFiles(glob?: string, max = 5000) {
  const args = ["--files"];
  if (glob) args.push("--glob", glob.includes("/") || glob.startsWith("*") ? glob : `**/${glob}`);
  const lines = await rg(args, max);
  const files = lines.map((l) => l.replace(/^\.[\\/]/, "").split(path.sep).join("/")).filter((f) => f && !isIgnored(f)).sort();
  return { files, truncated: lines.length >= max };
}

/** Fuzzy file search for Ctrl+P and the FILE_SEARCH tool. */
export async function fuzzyFiles(query: string, max = 50) {
  const { files } = await listFiles();
  const q = query.toLowerCase().replace(/\s+/g, "");
  const scored: { f: string; s: number }[] = [];
  for (const f of files) {
    const lf = f.toLowerCase();
    let i = 0, s = 0, last = -2;
    for (let j = 0; j < lf.length && i < q.length; j++) {
      if (lf[j] === q[i]) { s += j === last + 1 ? 3 : 1; if (lf[j - 1] === "/" || j === 0) s += 2; last = j; i++; }
    }
    if (i === q.length) scored.push({ f, s: s - f.length * 0.01 + (path.basename(lf).includes(q) ? 10 : 0) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.f);
}
