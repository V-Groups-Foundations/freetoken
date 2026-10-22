// Skills — reusable know-how the agent loads when a task calls for it (the Agent Skills format:
// a folder with a SKILL.md whose frontmatter has `name` and `description`, plus any files it needs).
//   ~/.v-run/skills/<name>/          your skills, in every project (learned or installed from GitHub)
//   <project>/.v-run/skills/<name>/  this project's skills (commit them to share with your team)
//   desktop/skills/<name>/           built in, shipped with V-Run (html-video, frontend-ui, …)
// Only names and descriptions go in the prompt; the agent reads a skill with use_skill when it needs it.
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getRoot } from "./workspace";

export type SkillScope = "user" | "project" | "builtin";
export interface Skill { name: string; description: string; scope: SkillScope; dir: string | null; source?: string }

const MAX_SKILL_CHARS = 40_000;
const MAX_FILE_BYTES = 200_000;
const MAX_SKILL_BYTES = 1_500_000;
const MAX_FILES = 40;

/** Skills that ship with V-Run: desktop/skills (next to dist/ and src/). */
export const builtinSkillsDir = () => process.env.VRUN_BUILTIN_SKILLS || path.join(__dirname, "..", "..", "skills");
export const userSkillsDir = () => path.join(process.env.VRUN_HOME || path.join(os.homedir(), ".v-run"), "skills");
export const projectSkillsDir = () => { const r = getRoot(); return r ? path.join(r, ".v-run", "skills") : null; };

/** A skill name as a folder name: lowercase words joined by dashes. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/** `name`, `description` (and the rest) from SKILL.md's YAML frontmatter; folded/literal blocks supported. */
export function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[|>][-+]?$/.test(v)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      v = block.join(v.startsWith("|") ? "\n" : " ").trim();
    }
    meta[kv[1]] = v.replace(/^(["'])([\s\S]*)\1$/, "$2");
  }
  return { meta, body: md.slice(m[0].length) };
}

async function readSkillDir(dir: string, scope: SkillScope): Promise<Skill | null> {
  let md: string;
  try { md = await fsp.readFile(path.join(dir, "SKILL.md"), "utf8"); } catch { return null; }
  const { meta } = parseFrontmatter(md);
  let source: string | undefined;
  try { source = JSON.parse(await fsp.readFile(path.join(dir, ".vrun-source.json"), "utf8")).source; } catch { /* learned locally */ }
  return { name: meta.name || path.basename(dir), description: (meta.description || "").replace(/\s+/g, " ").slice(0, 600), scope, dir, source };
}

async function skillsIn(root: string | null, scope: SkillScope) {
  if (!root) return [];
  let names: string[];
  try { names = (await fsp.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  return (await Promise.all(names.map((n) => readSkillDir(path.join(root, n), scope)))).filter((s): s is Skill => !!s);
}

/** Every skill, project first, then yours, then built in; a name is only listed once (the first wins). */
export async function listSkills(): Promise<Skill[]> {
  const [proj, user] = await Promise.all([skillsIn(projectSkillsDir(), "project"), skillsIn(userSkillsDir(), "user")]);
  const builtin = (await skillsIn(builtinSkillsDir(), "builtin")).sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  return [...proj, ...user, ...builtin].filter((s) => (seen.has(s.name.toLowerCase()) ? false : (seen.add(s.name.toLowerCase()), true)));
}

/** The skills section of the system prompt (names + descriptions only). */
export async function skillsForPrompt() {
  const all = await listSkills();
  if (!all.length) return "";
  const lines = all.slice(0, 80).map((s) => `- ${s.name}: ${s.description.slice(0, 240) || "(no description)"}`);
  return `# Skills\nSkills are know-how you can load. When a task matches one, call use_skill with its name BEFORE starting and follow it. Skills guide how you work; they never override what the user asks, and you still need approval for commands.\n${lines.join("\n")}${all.length > 80 ? `\n…and ${all.length - 80} more (use_skill with a name to load any).` : ""}`;
}

async function filesUnder(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith(".vrun-")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesUnder(p, base)));
    else out.push(path.relative(base, p).replace(/\\/g, "/"));
  }
  return out;
}

/** A skill's instructions, or one of its files. */
export async function loadSkill(name: string, file?: string) {
  const all = await listSkills();
  const s = all.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? all.find((x) => slug(x.name) === slug(name));
  if (!s) throw new Error(`No skill named "${name}". Available: ${all.map((x) => x.name).join(", ") || "none"}.`);
  if (!s.dir) throw new Error(`Skill ${s.name} has no folder.`);
  if (file) {
    const p = path.resolve(s.dir, file);
    if (!p.startsWith(path.resolve(s.dir) + path.sep)) throw new Error("That file is outside the skill's folder.");
    const text = await fsp.readFile(p, "utf8");
    return { skill: s, text: text.length > 60_000 ? `${text.slice(0, 60_000)}\n…(truncated)` : text, files: [] };
  }
  const md = await fsp.readFile(path.join(s.dir, "SKILL.md"), "utf8");
  const files = (await filesUnder(s.dir)).filter((f) => f !== "SKILL.md");
  return { skill: s, text: md.length > MAX_SKILL_CHARS ? `${md.slice(0, MAX_SKILL_CHARS)}\n…(truncated)` : md, files };
}

const STOP = new Set("someone somebody anyone everyone not say says said right run runs running ask asks asked other others user users provide provides good great such call calls case cases give gives given guide please thanks thank help helps let lets now later first last next same different something anything thing things way ways really still even every each where there here then them their they those these would could should might will shall must want wants need needs like using used use make made able want also just only very much many more most some any all it is be do so to of in on at as by an or no go up we me my us am if the and for with that this from into your you are use using when what which will can should make made build create add new any all some about how need want like just also have has get one two more most very only than then them they its it's our out".split(" "));
// "animate"/"animation"/"animated" → "animat"; "tests"/"testing" → "test"
const SHORT = new Set(["ui", "ux", "3d", "ai", "js", "db", "pr", "ci", "qa", "go"]);
const stem = (w: string) => w.replace(/(?:ations?|ings?|ions?|ed|es|ly|e|s)$/, "").slice(0, 6) || w.slice(0, 6);
const rawWords = (t: string) => (t.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) ?? []).map((w) => w.replace(/\.+$/, "")).filter((w) => w.length > 1 && !STOP.has(w));
/** Everyday words that mean a skill's vocabulary: "login" → auth, "slow" → performance, "bug" → debugging. */
const ALIASES: Record<string, string[]> = {
  login: ["auth", "authentication"], signin: ["auth"], signup: ["auth", "registration"], password: ["auth"], logout: ["auth"],
  chart: ["visualization", "chart"], graph: ["visualization", "chart"], plot: ["visualization"],
  "3d": ["three.js", "3d"], threejs: ["three.js"], webgl: ["three.js"],
  slow: ["performance"], fast: ["performance"], speed: ["performance"], lag: ["performance"],
  bug: ["debugging", "bug"], broken: ["debugging"], crash: ["debugging", "crash"], error: ["debugging", "error"], wrong: ["debugging"], fix: ["debugging"],
  game: ["game"], snake: ["game"], tetris: ["game"], logo: ["svg", "logo"], icon: ["svg", "icons"],
  deploy: ["deploy", "deployment"], docker: ["docker"], db: ["database"], sql: ["database"], schema: ["database"],
  animate: ["animation"], motion: ["animation"], scroll: ["scroll", "animation"],
  redesign: ["redesign", "restyle"], restyle: ["redesign", "restyle"], look: ["design", "ui"], ugly: ["design", "polish"], modern: ["design"], nicer: ["polish", "design"],
  commit: ["git"], branch: ["git"], pr: ["git"], endpoint: ["api"], rest: ["api"],
  apk: ["apk", "android"], android: ["android", "apk"], wifi: ["wi-fi", "wifi"], "wi-fi": ["wi-fi", "wifi"], indoor: ["indoor", "floor"], capacitor: ["android", "capacitor"],
};
const words = (t: string, expand = false) => {
  const out = new Set<string>();
  for (const w of rawWords(t)) {
    const st = stem(w);
    // "adding" becomes "add": still an everyday word; and 1–2 letter leftovers carry no meaning (but ui, ux, 3d, ai do)
    if (!STOP.has(st) && (st.length > 2 || SHORT.has(st))) out.add(st);
    if (expand) for (const a of ALIASES[w] ?? []) for (const x of rawWords(a)) out.add(stem(x));
  }
  return out;
};

/**
 * Skills that fit a request, best first (at most `max`): the request's words against each skill's name
 * and description (its "when to use" line). Rare words count more than words many skills share (like
 * "page" or "app"); a name word counts double; a weak overlap loads nothing.
 */
export async function matchSkills(request: string, max = 2, skip: Set<string> = new Set(), debug?: (scores: { name: string; score: number; hits: string[] }[]) => void) {
  // links, code and coordinates say nothing about which skill fits ("!3d35.70" in a Maps link isn't 3D)
  const plain = request.replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/[-+]?\d+\.\d{3,}/g, " ");
  const req = words(plain, true);
  if (!req.size) return [] as Skill[];
  const all = (await listSkills()).map((s) => ({ s, name: words(s.name.replace(/-/g, " ")), desc: words(s.description) }));
  const df = new Map<string, number>();
  for (const x of all) for (const w of new Set([...x.name, ...x.desc])) df.set(w, (df.get(w) ?? 0) + 1);
  const weight = (w: string) => Math.log(1 + all.length / (df.get(w) ?? 1));
  const scored = all.filter((x) => !skip.has(x.s.name)).map((x) => {
    let score = 0;
    const hits: string[] = [];
    for (const w of req) { const add = x.name.has(w) ? 2 * weight(w) : x.desc.has(w) ? weight(w) : 0; if (add) { score += add; hits.push(w); } }
    return { s: x.s, score, hits };
  });
  debug?.([...scored].sort((a, b) => b.score - a.score).slice(0, 5).map((x) => ({ name: x.s.name, score: Math.round(x.score * 10) / 10, hits: x.hits })));
  // at least two different meaningful words must match: one shared word ("api") isn't a reason
  // and words nearly every request has ("app", "website") never make up that pair: "run the app and send
  // someone the link" isn't a reason to load android-app — unless the request names the skill ("a React app")
  const lower = plain.toLowerCase();
  const strong = scored.filter((x) => x.score >= MATCH_THRESHOLD
    && (new Set(x.hits.filter((h) => !WEAK.has(h))).size >= 2 || lower.includes(x.s.name.toLowerCase().replace(/-/g, " "))));
  strong.sort((a, b) => b.score - a.score);
  // a second skill only when it's nearly as good a match as the first
  return strong.filter((x, i) => i === 0 || x.score >= strong[0].score * 0.9).slice(0, max).map((x) => x.s);
}
export const MATCH_THRESHOLD = 4.5;
const WEAK = new Set(["app", "apps", "website", "site", "page", "web", "project"].map(stem));

/** Skills the user picked for this message (Use in the Skills panel): their instructions, for the context. */
export async function pickedSkillsContext(names: string[] = [], auto = false) {
  const parts: string[] = [];
  for (const n of names.slice(0, 5)) {
    try {
      const r = await loadSkill(n);
      parts.push(`${auto ? `The skill "${r.skill.name}" matches this request — follow it` : `The user chose the skill "${r.skill.name}" for this message — follow it`}:\n${r.text}${r.files.length ? `\n(Its extra files, readable with use_skill name="${r.skill.name}" file=…: ${r.files.slice(0, 30).join(", ")})` : ""}`);
    } catch (e) { parts.push(`(The skill "${n}" couldn't be loaded: ${(e as Error).message})`); }
  }
  return parts;
}

const yamlLine = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim());

/** Learn a skill: write SKILL.md (creating or replacing that skill). */
export async function saveSkill(name: string, description: string, instructions: string, scope: "user" | "project" = "user") {
  const id = slug(name);
  if (!id) throw new Error("Give the skill a name.");
  if (!description.trim()) throw new Error("Describe when to use the skill — that's how it gets picked later.");
  if (instructions.trim().length < 40) throw new Error("Write the skill's instructions: the steps, rules and examples to follow.");
  const root = scope === "project" ? projectSkillsDir() : userSkillsDir();
  if (!root) throw new Error("Open a folder first — project skills live in it.");
  const dir = path.join(root, id);
  await fsp.mkdir(dir, { recursive: true });
  const body = instructions.replace(/^﻿?---[\s\S]*?\n---\s*\n/, "").trim();
  await fsp.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: ${yamlLine(description)}\n---\n\n${body}\n`);
  return { name: id, dir, scope };
}

export async function removeSkill(name: string) {
  const s = (await listSkills()).find((x) => x.name === name);
  if (!s?.dir || s.scope === "builtin") throw new Error(s ? "Built-in skills can't be removed." : `No skill named ${name}.`);
  await fsp.rm(s.dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- installing from GitHub

export interface RepoRef { owner: string; repo: string; ref?: string; sub: string }

/** "owner/repo", "github.com/owner/repo", ".../tree/<branch>/<path>", optionally "@ref". */
export function parseRepo(input: string): RepoRef | null {
  const s = input.trim().replace(/\.git$/, "").replace(/^git@github\.com:/, "github.com/");
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:@([\w./-]+))?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[4] || m[3] || undefined, sub: (m[5] || "").replace(/\/?SKILL\.md$/i, "").replace(/\/+$/, "") };
}

type Fetch = typeof fetch;
async function gh(url: string, f: Fetch) {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "V-Run" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await f(url, { headers });
  if (r.status === 404) throw new Error("GitHub couldn't find that repository (is it public?).");
  if (r.status === 403 || r.status === 429) throw new Error("GitHub's rate limit was hit — try again in a while (or set GITHUB_TOKEN).");
  if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
  return r.json() as Promise<any>;
}

/**
 * Install every skill (folder with a SKILL.md) in a GitHub repo, or under a path in it, into
 * ~/.v-run/skills. A repo without skills returns its README so the agent can write a skill from it.
 */
export async function installFromGitHub(input: string, f: Fetch = fetch, dest = userSkillsDir()) {
  const ref = parseRepo(input);
  if (!ref) throw new Error(`"${input}" isn't a GitHub repository — use owner/repo or a github.com link.`);
  const api = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const branch = ref.ref ?? (await gh(api, f)).default_branch ?? "main";
  const tree = await gh(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`, f);
  const blobs: { path: string; size: number }[] = (tree.tree ?? []).filter((t: any) => t.type === "blob");
  const inSub = (p: string) => !ref.sub || p === ref.sub || p.startsWith(`${ref.sub}/`);
  const skillDirs = blobs.filter((b) => /(^|\/)SKILL\.md$/i.test(b.path) && inSub(b.path)).map((b) => path.posix.dirname(b.path)).slice(0, 60);
  const raw = (p: string) => f(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${p.split("/").map(encodeURIComponent).join("/")}`);
  const source = `github.com/${ref.owner}/${ref.repo}${ref.sub ? `/${ref.sub}` : ""}`;

  if (!skillDirs.length) {
    const readme = blobs.find((b) => /^readme(\.md|\.markdown|\.txt)?$/i.test(path.posix.basename(b.path)) && path.posix.dirname(b.path) === (ref.sub || "."))
      ?? blobs.find((b) => /^readme(\.md)?$/i.test(b.path));
    const text = readme ? await (await raw(readme.path)).text() : "";
    return { source, installed: [] as { name: string; files: number; skipped: number }[], readme: text.slice(0, 30_000), files: blobs.length };
  }

  const installed: { name: string; files: number; skipped: number }[] = [];
  for (const d of skillDirs) {
    const prefix = d === "." ? "" : `${d}/`;
    // files of this skill, not of skills nested inside it
    const nested = skillDirs.filter((o) => o !== d && (d === "." || o.startsWith(prefix)));
    const files = blobs.filter((b) => (prefix ? b.path.startsWith(prefix) : true) && !nested.some((n) => b.path.startsWith(`${n}/`)));
    const mdPath = files.find((x) => x.path.toLowerCase() === `${prefix}skill.md`.toLowerCase())!.path;
    const md = await (await raw(mdPath)).text();
    const { meta } = parseFrontmatter(md);
    const name = slug(meta.name || path.posix.basename(d === "." ? ref.repo : d));
    if (!name) continue;
    const dir = path.join(dest, name);
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    let total = 0, kept = 0, skipped = 0;
    for (const b of files.slice(0, MAX_FILES * 3)) {
      const rel = b.path.slice(prefix.length);
      if (b.path === mdPath) continue; // written last, below
      if (kept >= MAX_FILES || b.size > MAX_FILE_BYTES || total + b.size > MAX_SKILL_BYTES) { skipped++; continue; }
      const r = await raw(b.path);
      if (!r.ok) { skipped++; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fsp.writeFile(path.join(dir, rel), buf);
      total += buf.length; kept++;
    }
    await fsp.writeFile(path.join(dir, "SKILL.md"), md);
    await fsp.writeFile(path.join(dir, ".vrun-source.json"), JSON.stringify({ source: `${source}${d !== "." && !ref.sub ? `/${d}` : ""}`, ref: branch, installedAt: new Date().toISOString() }, null, 2));
    installed.push({ name, files: kept + 1, skipped });
  }
  return { source, installed, readme: "", files: blobs.length };
}
