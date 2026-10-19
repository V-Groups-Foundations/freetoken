// Codebase index, modelled on cursor-retrieval (notes.md §4): files are SHA-256 hashed into a
// Merkle tree so a re-index only walks subtrees whose hash changed; changed files are re-chunked.
// Cursor embeds chunks server-side; we score chunks locally with BM25 so it works offline.
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { listFiles } from "./search";
import { getRoot, loadIgnore, looksBinary } from "./workspace";

export interface Chunk { path: string; start: number; end: number; text: string; tokens: Map<string, number>; len: number }
interface Node { hash: string; children?: Map<string, Node>; chunks?: Chunk[] }

const MAX_FILE = 400_000;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|exe|dll|so|dylib|woff2?|ttf|mp[34]|mov|lock)$/i;

let tree: Node | null = null;
let rootFor: string | null = null;
let df = new Map<string, number>();
let chunkCount = 0;
let totalLen = 0;
export let lastStats = { files: 0, chunks: 0, rootHash: "", changedFiles: 0, ms: 0 };

const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of text.match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? []) {
    const lw = w.toLowerCase();
    if (lw.length > 1 && lw.length < 40) out.push(lw);
    // split camelCase / snake_case so "getUserName" also matches "user"
    const parts = w.split(/_|(?<=[a-z0-9])(?=[A-Z])/).filter((p) => p.length > 1);
    if (parts.length > 1) for (const p of parts) out.push(p.toLowerCase());
  }
  return out;
}

/** Syntax-aware-lite chunking: break at top-level declarations, cap chunk size, window long runs. */
export function chunkFile(rel: string, text: string): Chunk[] {
  const lines = text.split(/\r?\n/);
  const starts: number[] = [0];
  const decl = /^(export\s+|async\s+|public\s+|private\s+|static\s+)*(function|class|interface|type|enum|const|let|def|fn|func|struct|impl|module|namespace)\b|^#{1,3}\s/;
  for (let i = 1; i < lines.length; i++) if (decl.test(lines[i]) && i - starts[starts.length - 1] >= 3) starts.push(i);
  const chunks: Chunk[] = [];
  for (let s = 0; s < starts.length; s++) {
    const a = starts[s], b = s + 1 < starts.length ? starts[s + 1] : lines.length;
    for (let w = a; w < b; w += 50) {
      const end = Math.min(b, w + 60);
      const body = lines.slice(w, end).join("\n");
      if (!body.trim()) continue;
      const toks = tokenize(`${rel} ${body}`);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      chunks.push({ path: rel, start: w + 1, end, text: body, tokens: tf, len: toks.length });
      if (end >= b) break;
    }
  }
  return chunks;
}

function addStats(chunks: Chunk[], sign: 1 | -1) {
  for (const c of chunks) {
    chunkCount += sign; totalLen += sign * c.len;
    for (const t of c.tokens.keys()) df.set(t, (df.get(t) ?? 0) + sign);
  }
}
function collect(n: Node, out: Chunk[] = []) {
  if (n.chunks) out.push(...n.chunks);
  for (const c of n.children?.values() ?? []) collect(c, out);
  return out;
}

/** Build or incrementally update the index. Returns how many files were (re)chunked. */
export async function reindex(onProgress?: (done: number, total: number) => void) {
  const t0 = Date.now();
  const root = getRoot();
  if (!root) throw new Error("No folder is open");
  if (rootFor !== root) { tree = null; df = new Map(); chunkCount = 0; totalLen = 0; rootFor = root; }
  const indexIgnore = loadIgnore(root, [".cursorindexingignore"]);
  const { files } = await listFiles(undefined, 20000);
  const wanted = files.filter((f) => !SKIP_EXT.test(f) && !indexIgnore(f, false));

  // leaf hashes
  const leaves = new Map<string, { hash: string; text: string | null }>();
  let done = 0;
  await Promise.all(Array.from({ length: 16 }, async (_, w) => {
    for (let i = w; i < wanted.length; i += 16) {
      const rel = wanted[i];
      try {
        const buf = await fsp.readFile(path.join(root, rel));
        if (buf.length <= MAX_FILE && !looksBinary(buf)) leaves.set(rel, { hash: sha(buf), text: buf.toString("utf8") });
      } catch { /* deleted mid-scan */ }
      onProgress?.(++done, wanted.length);
    }
  }));

  // build the new tree, reusing unchanged subtrees from the old one (Merkle diff)
  let changed = 0;
  const build = (prefix: string, names: string[], old?: Node): Node => {
    const groups = new Map<string, string[]>();
    const filesHere: string[] = [];
    for (const n of names) {
      const i = n.indexOf("/");
      if (i < 0) filesHere.push(n);
      else { const d = n.slice(0, i); groups.set(d, [...(groups.get(d) ?? []), n.slice(i + 1)]); }
    }
    const children = new Map<string, Node>();
    for (const f of filesHere) {
      const rel = prefix + f;
      const leaf = leaves.get(rel)!;
      const prev = old?.children?.get(f);
      if (prev && prev.hash === leaf.hash && prev.chunks) { children.set(f, prev); continue; }
      if (prev?.chunks) addStats(prev.chunks, -1);
      const chunks = chunkFile(rel, leaf.text!);
      addStats(chunks, 1);
      changed++;
      children.set(f, { hash: leaf.hash, chunks });
    }
    for (const [d, sub] of groups) children.set(d, build(`${prefix}${d}/`, sub, old?.children?.get(d)));
    // drop chunks of files that disappeared
    for (const [name, prev] of old?.children ?? []) if (!children.has(name)) addStats(collect(prev), -1);
    const hash = sha([...children].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, c]) => `${n}:${c.hash}`).join("\n"));
    return { hash, children };
  };
  const names = [...leaves.keys()];
  // fast path: identical root hash means nothing to do
  tree = build("", names, tree ?? undefined);
  for (const [k, v] of df) if (v <= 0) df.delete(k);
  lastStats = { files: names.length, chunks: chunkCount, rootHash: tree.hash, changedFiles: changed, ms: Date.now() - t0 };
  return lastStats;
}

export interface SearchResult { path: string; start: number; end: number; score: number; text: string }

/** BM25 over chunks. */
export function search(query: string, k = 10): SearchResult[] {
  if (!tree) return [];
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const N = Math.max(1, chunkCount), avg = totalLen / N || 1, k1 = 1.2, b = 0.75;
  const scored: SearchResult[] = [];
  for (const c of collect(tree)) {
    let s = 0;
    for (const t of q) {
      const f = c.tokens.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.len) / avg)));
    }
    if (s > 0) scored.push({ path: c.path, start: c.start, end: c.end, score: s, text: c.text });
  }
  scored.sort((a, b) => b.score - a.score);
  // at most 2 chunks per file so one big file doesn't crowd out the rest
  const per = new Map<string, number>();
  return scored.filter((r) => { const n = per.get(r.path) ?? 0; per.set(r.path, n + 1); return n < 2; }).slice(0, k);
}
