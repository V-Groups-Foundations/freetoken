// Click-through checks that live in the project (.v-run/checks/*.json): when a feature works, the agent
// saves how it verified it — load the page, do something (a script), expect something (a script that
// must be truthy). V-Run reruns them all after every task that changed files, without the model, so a
// later fix that breaks an earlier feature is caught before the agent says it's done.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getRoot } from "./workspace";
import type { PreviewHost } from "./runner";

export const stepSchema = z.object({
  /** JavaScript to run first (click a button, fill a field); optional */
  action: z.string().max(4000).optional(),
  /** a JavaScript expression that must be truthy afterwards */
  expect: z.string().min(1).max(4000),
  /** how long to wait after the action before checking (ms) */
  wait_ms: z.number().int().min(0).max(15_000).optional(),
});
export const checkSchema = z.object({
  name: z.string().min(1).max(80),
  /** the page to load (default: the page open in the preview) */
  url: z.string().max(500).optional(),
  steps: z.array(stepSchema).min(1).max(20),
});
export type Check = z.infer<typeof checkSchema>;
export type CheckResult = { name: string; ok: boolean; detail: string };

const dirOf = (root: string) => path.join(root, ".v-run", "checks");
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "check";

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

/**
 * The page a check loads. The app's port changes between runs (a busy port, a restart), so a check keeps
 * only the path of a local address and is pointed at wherever the app runs now (`current`).
 */
export function pageFor(saved: string | undefined, current?: string) {
  const base = current && LOCAL.test(current) ? new URL(current).origin : null;
  if (!saved) return current;
  if (saved.startsWith("/")) return base ? base + saved : undefined;
  if (LOCAL.test(saved) && base) { const u = new URL(saved); return base + u.pathname + u.search + u.hash; }
  return saved;
}

export async function saveCheck(c: Check) {
  const root = getRoot();
  if (!root) throw new Error("Open a folder first");
  const check = checkSchema.parse(c);
  if (check.url && LOCAL.test(check.url)) { const u = new URL(check.url); check.url = u.pathname + u.search + u.hash; }
  await fs.mkdir(dirOf(root), { recursive: true });
  const file = path.join(dirOf(root), `${slug(check.name)}.json`);
  await fs.writeFile(file, `${JSON.stringify(check, null, 2)}\n`);
  return path.relative(root, file).replace(/\\/g, "/");
}

/** Every saved check of the open project (malformed files are reported, not fatal). */
export async function loadChecks(): Promise<{ checks: Check[]; broken: string[] }> {
  const root = getRoot();
  if (!root) return { checks: [], broken: [] };
  const files = await fs.readdir(dirOf(root)).catch(() => [] as string[]);
  const checks: Check[] = [], broken: string[] = [];
  for (const f of files.filter((x) => x.endsWith(".json")).sort()) {
    try { checks.push(checkSchema.parse(JSON.parse(await fs.readFile(path.join(dirOf(root), f), "utf8")))); }
    catch { broken.push(f); }
  }
  return { checks, broken };
}

/** A probe result that counts as "yes": anything but false / null / undefined / 0 / "" / an error. */
export const truthy = (r: string) => !/^(false|null|undefined|0|""|NaN)?$/.test(r.trim()) && !r.startsWith("Error");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Host = PreviewHost & { evaluate: NonNullable<PreviewHost["evaluate"]> };
type Saved = { url: string; data: { l: [string, string][]; s: [string, string][] } | null };

const MAX_SNAPSHOT = 1_000_000;
/** The page's localStorage + sessionStorage, read out in pieces (a script's answer is cut at 6000 characters); null when there is none or it's too big to put back. */
async function snapshot(host: Host): Promise<Saved["data"]> {
  const piece = (from: number) => `(() => { const d = JSON.stringify({ l: Object.entries(localStorage), s: Object.entries(sessionStorage) }); return ${from} < 0 ? d.length : d.slice(${from}, ${from + 4000}); })()`;
  const len = Number(await host.evaluate(piece(-1)));
  if (!Number.isFinite(len) || len <= 0 || len > MAX_SNAPSHOT) return null;
  let d = "";
  for (let i = 0; i < len; i += 4000) {
    const r = await host.evaluate(piece(i));
    try { d += JSON.parse(r); } catch { return null; }
  }
  try { return JSON.parse(d); } catch { return null; }
}
// the page may save its state as it unloads (that put cleared data straight back): no writes until it reloads
const WIPE = "localStorage.clear(); sessionStorage.clear(); Storage.prototype.setItem = () => {}; true";
const fill = (data: NonNullable<Saved["data"]>) =>
  `localStorage.clear(); sessionStorage.clear(); for (const [k, v] of ${JSON.stringify(data.l)}) localStorage.setItem(k, v); for (const [k, v] of ${JSON.stringify(data.s)}) sessionStorage.setItem(k, v); Storage.prototype.setItem = () => {}; true`;

/**
 * Run checks against the preview: each loads its page fresh, then runs its steps in order. A check that
 * fails is run once more from a fresh page before it counts: a timing fluke (a transition, a slow fetch)
 * passing on the second go isn't a broken feature, and reporting it sent the agent rewriting checks.
 * Each check starts from the app's first-visit state: the page's saved data is cleared first (a task one
 * check added stayed in localStorage, so another's "2 active" never held again and a working app kept
 * failing), and what the user had is put back once the checks are done.
 */
export async function runChecks(host: PreviewHost | null, checks: Check[], fallbackUrl?: string, signal?: AbortSignal): Promise<CheckResult[]> {
  if (!host?.evaluate) return checks.map((c) => ({ name: c.name, ok: false, detail: "no preview pane to run it in" }));
  const h = host as Host;
  const saved = new Map<string, Saved>();
  const out: CheckResult[] = [];
  try {
    for (const c of checks) {
      if (signal?.aborted) break;
      let r = await runOne(h, c, fallbackUrl, saved);
      if (!r.ok && r.retry && !signal?.aborted) r = await runOne(h, c, fallbackUrl, saved);
      out.push({ name: c.name, ok: r.ok, detail: r.detail });
    }
  } finally {
    for (const { url, data } of saved.values()) {
      if (!data || (await h.open(url))) continue;
      await h.evaluate(fill(data));
      await h.open(url);
    }
  }
  return out;
}

async function runOne(host: Host, c: Check, fallbackUrl: string | undefined, saved: Map<string, Saved>): Promise<{ ok: boolean; detail: string; retry?: boolean }> {
  const url = pageFor(c.url, fallbackUrl);
  if (!url) return { ok: false, detail: "no page to load: start the app first" };
  let err = await host.open(url);
  if (err) return { ok: false, detail: `${url} didn't load: ${err}` };
  const origin = (() => { try { return new URL(url).origin; } catch { return url; } })();
  if (!saved.has(origin)) saved.set(origin, { url, data: await snapshot(host) });
  // only a page whose data could be put back is wiped
  if (saved.get(origin)!.data) {
    await host.evaluate(WIPE);
    err = await host.open(url);
    if (err) return { ok: false, detail: `${url} didn't load: ${err}` };
  }
  await sleep(500);
  for (const [i, step] of c.steps.entries()) {
    if (step.action) {
      const r = await host.evaluate(step.action);
      if (r.startsWith("Error")) return { ok: false, detail: `step ${i + 1}: the action failed — ${r.slice(0, 200)}`, retry: true };
    }
    await sleep(step.wait_ms ?? 400);
    // wait a little for it to become true (animations, fetches) before calling it a failure
    let r = await host.evaluate(step.expect);
    for (let t = 0; !truthy(r) && t < 4; t++) { await sleep(500); r = await host.evaluate(step.expect); }
    if (!truthy(r)) return { ok: false, detail: `step ${i + 1}: expected \`${step.expect.slice(0, 120)}\` to be true, got ${r.slice(0, 200)}`, retry: true };
  }
  return { ok: true, detail: `${c.steps.length} step(s) passed` };
}

export const describeResults = (rs: CheckResult[]) => rs.map((r) => `${r.ok ? "✓" : "✗"} ${r.name} — ${r.detail}`).join("\n");
