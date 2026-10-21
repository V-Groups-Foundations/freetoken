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

export async function saveCheck(c: Check) {
  const root = getRoot();
  if (!root) throw new Error("Open a folder first");
  const check = checkSchema.parse(c);
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

/** Run checks against the preview: each loads its page fresh, then runs its steps in order. */
export async function runChecks(host: PreviewHost | null, checks: Check[], fallbackUrl?: string, signal?: AbortSignal): Promise<CheckResult[]> {
  if (!host?.evaluate) return checks.map((c) => ({ name: c.name, ok: false, detail: "no preview pane to run it in" }));
  const out: CheckResult[] = [];
  for (const c of checks) {
    if (signal?.aborted) break;
    const url = c.url || fallbackUrl;
    if (!url) { out.push({ name: c.name, ok: false, detail: "no page to load: start the app first" }); continue; }
    const err = await host.open(url);
    if (err) { out.push({ name: c.name, ok: false, detail: `${url} didn't load: ${err}` }); continue; }
    await sleep(500);
    let failed: string | null = null;
    for (const [i, step] of c.steps.entries()) {
      if (step.action) {
        const r = await host.evaluate(step.action);
        if (r.startsWith("Error")) { failed = `step ${i + 1}: the action failed — ${r.slice(0, 200)}`; break; }
      }
      await sleep(step.wait_ms ?? 400);
      // wait a little for it to become true (animations, fetches) before calling it a failure
      let r = await host.evaluate(step.expect);
      for (let t = 0; !truthy(r) && t < 4; t++) { await sleep(500); r = await host.evaluate(step.expect); }
      if (!truthy(r)) { failed = `step ${i + 1}: expected \`${step.expect.slice(0, 120)}\` to be true, got ${r.slice(0, 200)}`; break; }
    }
    out.push({ name: c.name, ok: !failed, detail: failed ?? `${c.steps.length} step(s) passed` });
  }
  return out;
}

export const describeResults = (rs: CheckResult[]) => rs.map((r) => `${r.ok ? "✓" : "✗"} ${r.name} — ${r.detail}`).join("\n");
