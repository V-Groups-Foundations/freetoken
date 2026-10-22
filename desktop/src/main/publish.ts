// Publish: put the project's website online with one click, on a free host — Cloudflare Pages
// (recommended) or Netlify — through their official CLIs (run with npx, nothing to install). The flow:
// build it if the project has a build step, find the folder with index.html (staging the project's own
// web files when that's the project folder itself — never node_modules, .git or V-Run's own files), sign
// in through the browser if needed, create the site the first time, deploy, and report the address.
// The last publish is kept in .v-run/publish.json so the next one goes to the same site.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getRoot } from "./workspace";
import { killTree, windowsShell } from "./runner";

export type Provider = "cloudflare" | "netlify";
export interface PublishPlan {
  name: string;
  /** a build command to run first, when the project has one */
  build: string | null;
  /** the folder that becomes the website ("." = the project folder itself) */
  dir: string | null;
  /** something that needs a server (it won't run on a static host) */
  server: string | null;
  last: PublishRecord | null;
  problem: string | null;
}
export interface PublishRecord { provider: Provider; name: string; url: string; at: number }

const OUT_DIRS = ["dist", "build", "out", "public", "_site", "www", "docs"];
const SKIP = new Set(["node_modules", ".git", ".v-run", ".vscode", ".idea", "android", "ios", ".next", ".nuxt", ".svelte-kit", "coverage", "__pycache__", ".venv", "venv"]);

/** A valid site name from the folder name: lowercase letters, digits and dashes. */
export const siteName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "my-site";

function readJson(file: string): any { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
const recordFile = (root: string) => path.join(root, ".v-run", "publish.json");
export const lastPublish = (root: string): PublishRecord | null => readJson(recordFile(root));

/** What publishing this project would do. */
export function planPublish(root = getRoot()): PublishPlan {
  if (!root) return { name: "", build: null, dir: null, server: null, last: null, problem: "Open a folder first." };
  const pkg = readJson(path.join(root, "package.json"));
  const build = pkg?.scripts?.build ? "npm run build" : null;
  const has = (d: string) => fs.existsSync(path.join(root, d, "index.html"));
  const dir = OUT_DIRS.find(has) ?? (has(".") ? "." : null);
  const serverFile = ["server.js", "server.mjs", "server.ts", "app.py", "main.py", "server.py"].find((f) => fs.existsSync(path.join(root, f)));
  const server = serverFile ?? (pkg?.dependencies && /express|fastify|koa|hono|socket\.io|ws\b/.test(Object.keys(pkg.dependencies).join(" ")) ? "package.json (a Node server)" : null);
  const last = lastPublish(root);
  const problem = !dir && !build ? "Nothing to publish as a website yet: there's no index.html (and no build step that makes one)." : null;
  return { name: last?.name ?? siteName(pkg?.name || path.basename(root)), build, dir: dir ?? (build ? "dist" : null), server, last, problem };
}

/** The project folder as a website, without what must never go online. */
export function stageSite(root: string, into: string) {
  fs.rmSync(into, { recursive: true, force: true });
  const copy = (from: string, to: string) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name.startsWith(".env") || /\.(md|log|lock)$/i.test(e.name) || ["package.json", "package-lock.json", "V.md"].includes(e.name)) continue;
      const src = path.join(from, e.name), dst = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); copy(src, dst); }
      else if (e.isFile() && fs.statSync(src).size < 25 * 1024 * 1024) { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(src, dst); }
    }
  };
  copy(root, into);
  return into;
}

/** The deployed address in a CLI's output. */
export function publishedUrl(provider: Provider, out: string): string | null {
  if (provider === "cloudflare") return /https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)?\.pages\.dev\b/i.exec(out)?.[0] ?? null;
  const json = /\{[\s\S]*"(?:url|deploy_url)"[\s\S]*\}/.exec(out)?.[0];
  if (json) { try { const j = JSON.parse(json); return j.url ?? j.deploy_url ?? null; } catch { /* not the JSON block */ } }
  return /https:\/\/[a-z0-9-]+\.netlify\.app\b/i.exec(out)?.[0] ?? null;
}

// ---------------------------------------------------------------- running it

type Log = (line: string) => void;
let current: ReturnType<typeof spawn> | null = null;

/** Run one command in the project, streaming its output; resolves with its output and exit code. */
function run(cmd: string, cwd: string, log: Log, timeoutMs = 15 * 60_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    log(`$ ${cmd}`);
    const win = process.platform === "win32";
    const p = spawn(win ? windowsShell() : "/bin/bash", win ? ["-NoProfile", "-NonInteractive", "-Command", cmd] : ["-lc", cmd],
      { cwd, windowsHide: true, detached: !win, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "", WRANGLER_SEND_METRICS: "false" } });
    current = p;
    let out = "";
    const timer = setTimeout(() => { log("(took too long — stopped)"); killTree(p); }, timeoutMs);
    const onData = (d: Buffer) => { const t = d.toString().replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ""); out += t; for (const l of t.split(/\r?\n/)) if (l.trim()) log(l); };
    p.stdout?.on("data", onData);
    p.stderr?.on("data", onData);
    p.on("error", (e) => { out += e.message; log(e.message); });
    p.on("close", (code) => { clearTimeout(timer); if (current === p) current = null; resolve({ code, out }); });
  });
}

export function cancelPublish() { if (current) killTree(current); }

const CLI = { cloudflare: "npx --yes wrangler@4", netlify: "npx --yes netlify-cli@27" } as const;

/** Publish the project. `exec` overrides how commands run (tests). */
export async function publish(opts: { provider: Provider; name: string; build: string | null; dir: string }, log: Log, exec = run): Promise<PublishRecord> {
  const root = getRoot();
  if (!root) throw new Error("Open a folder first.");
  const name = siteName(opts.name);
  // 1. build
  if (opts.build) {
    if (!fs.existsSync(path.join(root, "node_modules")) && fs.existsSync(path.join(root, "package.json"))) {
      const inst = await exec("npm install", root, log);
      if (inst.code !== 0) throw new Error("npm install failed — see the log.");
    }
    const b = await exec(opts.build, root, log);
    if (b.code !== 0) throw new Error("The build failed — see the log (or ask the agent to fix it).");
  }
  // 2. the folder that goes online
  let dir = path.resolve(root, opts.dir || ".");
  if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error(`${path.relative(root, dir) || "The project folder"} has no index.html to publish.`);
  if (path.resolve(dir) === path.resolve(root)) dir = stageSite(root, path.join(root, ".v-run", "tmp", "site"));
  const cli = CLI[opts.provider];
  // 3. signed in?
  const who = await exec(opts.provider === "cloudflare" ? `${cli} whoami` : `${cli} status`, root, log, 120_000);
  if (/not (authenticated|logged in)|log ?in|no .*token/i.test(who.out) || who.code !== 0) {
    log("Sign in in the browser window that opens — publishing continues once you're signed in.");
    const login = await exec(`${cli} login`, root, log, 10 * 60_000);
    if (login.code !== 0) throw new Error("Signing in didn't finish — try Publish again.");
  }
  // 4. create the site (first time) and deploy
  let out: string;
  if (opts.provider === "cloudflare") {
    const created = await exec(`${cli} pages project create ${name} --production-branch main`, root, log, 120_000);
    if (created.code !== 0 && !/already exists|already in use|8000002/i.test(created.out)) throw new Error("Couldn't create the Cloudflare Pages project — see the log (the name may be taken: try another).");
    const d = await exec(`${cli} pages deploy "${dir}" --project-name ${name} --branch main --commit-dirty=true`, root, log);
    if (d.code !== 0) throw new Error("The deploy failed — see the log.");
    out = d.out;
  } else {
    const d = await exec(`${cli} deploy --prod --no-build --json --dir "${dir}" --site-name ${name}`, root, log);
    if (d.code !== 0) throw new Error("The deploy failed — see the log (the name may be taken: try another).");
    out = d.out;
  }
  const found = publishedUrl(opts.provider, out);
  // the stable production address (the per-deploy one changes every time)
  const url = opts.provider === "cloudflare" ? `https://${name}.pages.dev` : found ?? "";
  if (!found) throw new Error("It deployed, but the address wasn't in the output — check the log.");
  const rec: PublishRecord = { provider: opts.provider, name, url, at: Date.now() };
  fs.mkdirSync(path.join(root, ".v-run"), { recursive: true });
  fs.writeFileSync(recordFile(root), `${JSON.stringify(rec, null, 2)}\n`);
  log(`Published: ${url}`);
  return rec;
}
