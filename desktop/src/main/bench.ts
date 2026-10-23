// Benchmark your models: the same small, real coding tasks for each model, run through the actual
// agent loop in throwaway projects and graded by running the result (no AI judging AI). The results
// are shown side by side and sent to FreeToken as feedback, so auto routing learns which of the
// user's models really do agent work well.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withRoot } from "./workspace";
import { approve, getSession, resetSession, type AgentEvent, type ChatRequest } from "./ai";

export interface BenchTask {
  id: string;
  title: string;
  files: Record<string, string>;
  prompt: string;
  /** null when it passed, otherwise what's wrong */
  grade: (dir: string) => Promise<string | null>;
}

const node = (dir: string, args: string[]) => new Promise<{ code: number; out: string }>((resolve) =>
  // V-Run's own runtime runs the graders (Electron acts as Node with ELECTRON_RUN_AS_NODE): no Node install needed
  execFile(process.execPath, args,
    { cwd: dir, timeout: 20_000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    (e, out, err) => resolve({ code: e ? (typeof (e as any).code === "number" ? (e as any).code : 1) : 0, out: `${out}${err}` })));
const read = (dir: string, f: string) => { try { return fs.readFileSync(path.join(dir, f), "utf8"); } catch { return null; } };

export const TASKS: BenchTask[] = [
  {
    id: "fix-bug",
    title: "Fix a failing test",
    files: {
      "cart.js": "// total of a shopping cart: price × quantity for each item\nfunction total(items) {\n  let sum = 0;\n  for (let i = 1; i < items.length; i++) sum += items[i].price * items[i].qty;\n  return sum;\n}\nmodule.exports = { total };\n",
      "test.js": "const assert = require('assert');\nconst { total } = require('./cart');\nassert.strictEqual(total([{ price: 2, qty: 3 }, { price: 5, qty: 1 }]), 11);\nassert.strictEqual(total([]), 0);\nconsole.log('ok');\n",
    },
    prompt: "The test in test.js fails. Find the bug in cart.js and fix it, then run `node test.js` to confirm it prints ok. Don't change test.js.",
    grade: async (d) => {
      if (!read(d, "test.js")?.includes("total([{ price: 2, qty: 3 }")) return "test.js was changed";
      const r = await node(d, ["test.js"]);
      return r.code === 0 && r.out.includes("ok") ? null : `node test.js failed: ${r.out.slice(0, 200)}`;
    },
  },
  {
    id: "new-program",
    title: "Write a small program",
    files: { "numbers.txt": "4\n8\n15\n16\n23\n42\n" },
    prompt: "Create stats.js that reads numbers.txt (one number per line) and prints exactly one line: `sum=<sum> max=<max>`. Run it to check.",
    grade: async (d) => {
      const r = await node(d, ["stats.js"]);
      return r.out.trim() === "sum=108 max=42" ? null : `stats.js printed "${r.out.trim().slice(0, 120)}"`;
    },
  },
  {
    id: "rename",
    title: "Rename across files",
    files: {
      "util.js": "function calc(a, b) {\n  return a * b + 1;\n}\nmodule.exports = { calc };\n",
      "main.js": "const { calc } = require('./util');\nconsole.log(calc(3, 4));\n",
      "report.js": "const util = require('./util');\nmodule.exports = () => `value: ${util.calc(2, 2)}`;\n",
    },
    prompt: "Rename the function calc to computeScore everywhere in this project (definition, export and every use). Make sure `node main.js` still prints 13.",
    grade: async (d) => {
      const all = ["util.js", "main.js", "report.js"].map((f) => read(d, f) ?? "").join("\n");
      if (/\bcalc\b/.test(all)) return "calc is still used somewhere";
      if (!/computeScore/.test(read(d, "report.js") ?? "")) return "report.js wasn't updated";
      const r = await node(d, ["main.js"]);
      return r.out.trim() === "13" ? null : `node main.js printed "${r.out.trim().slice(0, 120)}"`;
    },
  },
  {
    id: "feature",
    title: "Add a feature with a test",
    files: {
      "todo.js": "// a tiny todo list\nclass Todos {\n  constructor() { this.items = []; }\n  add(text) { this.items.push({ text, done: false }); return this.items.length - 1; }\n  complete(i) { this.items[i].done = true; }\n}\nmodule.exports = { Todos };\n",
    },
    prompt: "Add a method remaining() to the Todos class in todo.js that returns how many items are not done. Then write test.js that checks it with assert (add 3, complete 1, expect 2) and prints ok, and run it.",
    grade: async (d) => {
      const check = "const { Todos } = require('./todo'); const t = new Todos(); t.add('a'); t.add('b'); t.add('c'); t.complete(1); if (t.remaining() !== 2) throw new Error('remaining() = ' + t.remaining()); const u = new Todos(); if (u.remaining() !== 0) throw new Error('empty list'); console.log('graded ok');";
      const r = await node(d, ["-e", check]);
      if (!r.out.includes("graded ok")) return `remaining() is wrong: ${r.out.slice(0, 160)}`;
      const t = await node(d, ["test.js"]);
      return t.code === 0 && t.out.includes("ok") ? null : "test.js missing or failing";
    },
  },
  // ---- harder: closer to real work (the cause is elsewhere, the error must be read, several steps)
  {
    id: "distant-bug",
    title: "A bug in another file than the failure",
    files: {
      "parse.js": "// \"2026-03-09\" → { y, m, d }\nfunction parseDate(s) {\n  const [y, m, d] = s.split('-').map(Number);\n  return { y, m: m - 1, d };\n}\nmodule.exports = { parseDate };\n",
      "format.js": "const { parseDate } = require('./parse');\nconst MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];\n// \"2026-03-09\" → \"9 Mar 2026\"\nfunction pretty(s) {\n  const { y, m, d } = parseDate(s);\n  return `${d} ${MONTHS[m - 1]} ${y}`;\n}\nmodule.exports = { pretty };\n",
      "test.js": "const assert = require('assert');\nconst { pretty } = require('./format');\nconst { parseDate } = require('./parse');\nassert.strictEqual(pretty('2026-03-09'), '9 Mar 2026');\nassert.strictEqual(pretty('2025-12-25'), '25 Dec 2025');\nassert.deepStrictEqual(parseDate('2026-01-02'), { y: 2026, m: 1, d: 2 });\nconsole.log('ok');\n",
    },
    prompt: "`node test.js` fails. Find the real cause and fix it (don't change test.js), then run the test to confirm it prints ok.",
    grade: async (d) => {
      if (!read(d, "test.js")?.includes("m: 1, d: 2")) return "test.js was changed";
      const r = await node(d, ["test.js"]);
      return r.code === 0 && r.out.includes("ok") ? null : `node test.js failed: ${r.out.slice(0, 200)}`;
    },
  },
  {
    id: "read-the-error",
    title: "Fix a crash from its stack trace",
    files: {
      "data.js": "// pretend this reads from a server\nasync function loadOrders() {\n  await new Promise((r) => setTimeout(r, 10));\n  return [{ id: 1, total: 30 }, { id: 2, total: 12.5 }];\n}\nmodule.exports = { loadOrders };\n",
      "report.js": "const { loadOrders } = require('./data');\n\nfunction main() {\n  const orders = loadOrders();\n  const lines = orders.map((o) => `#${o.id}: ${o.total.toFixed(2)}`);\n  console.log(lines.join('\\n'));\n  console.log('total: ' + orders.reduce((s, o) => s + o.total, 0).toFixed(2));\n}\n\nmain();\n",
    },
    prompt: "`node report.js` crashes. Fix it so it prints each order and the total, and run it to check.",
    grade: async (d) => {
      const r = await node(d, ["report.js"]);
      const out = r.out.trim().replace(/\r/g, "");
      return r.code === 0 && out === "#1: 30.00\n#2: 12.50\ntotal: 42.50" ? null : `report.js printed "${out.slice(0, 160)}"`;
    },
  },
  {
    id: "small-cli",
    title: "Build a small command-line app",
    files: { "README.md": "# notes\n" },
    prompt: "Create notes.js, a command-line notes app that keeps its notes in notes.json next to it:\n- `node notes.js add <text...>` adds a note and prints `added #<n>` (n counts from 1)\n- `node notes.js list` prints one line per note: `<n>. <text>` (nothing if there are none)\n- `node notes.js done <n>` removes note n and prints `removed #<n>`; for a note that doesn't exist it prints `no note #<n>` and exits with code 1\nRun each command to check it works.",
    grade: async (d) => {
      try { fs.rmSync(path.join(d, "notes.json"), { force: true }); } catch { /* none yet */ }
      const steps: [string[], RegExp, number][] = [
        [["notes.js", "list"], /^$/, 0],
        [["notes.js", "add", "buy", "milk"], /^added #1$/, 0],
        [["notes.js", "add", "call", "mum"], /^added #2$/, 0],
        [["notes.js", "list"], /^1\. buy milk\n2\. call mum$/, 0],
        [["notes.js", "done", "1"], /^removed #1$/, 0],
        [["notes.js", "done", "7"], /^no note #7$/, 1],
      ];
      for (const [args, want, code] of steps) {
        const r = await node(d, args);
        const out = r.out.trim().replace(/\r/g, "");
        if (!want.test(out) || (code === 0 ? r.code !== 0 : r.code === 0)) return `node ${args.join(" ")} → "${out.slice(0, 120)}" (exit ${r.code})`;
      }
      return null;
    },
  },
  {
    id: "stay-in-scope",
    title: "Answer without changing anything",
    files: {
      "server.js": "// a tiny web server (not started by this task)\nconst http = require('http');\nconst PORT = 8080;\nhttp.createServer((req, res) => res.end('hello')).listen(PORT);\n",
      "styles.css": "body { color: #333 }\n.title { font-size: 2rem }\n",
    },
    prompt: "Which port does server.js listen on? Just tell me — don't change or start anything.",
    grade: async (d) => {
      const same = read(d, "server.js")?.includes("const PORT = 8080;") && read(d, "styles.css") === "body { color: #333 }\n.title { font-size: 2rem }\n"
        && fs.readdirSync(d).filter((f) => !f.startsWith(".")).sort().join(",") === "server.js,styles.css";
      return same ? null : "files were changed or added";
    },
  },
];

export interface BenchResult {
  model: string; task: string; ok: boolean; why: string | null; ms: number; steps: number; tokens: number;
  /** other models FreeToken answered with (the one asked for was busy): not reported as this model's result */
  fellBack?: string[];
  /** it failed because the service stopped it (overloaded, out of quota): not the model's result either */
  serviceError?: boolean;
}
export type BenchEvent = { type: "start"; model: string; task: string } | { type: "result"; result: BenchResult } | { type: "done"; results: BenchResult[] };

let cancelled = false;
let running: string | null = null; // the session of the task in progress
export const cancelBenchmark = () => { cancelled = true; if (running) getSession(running).abort?.abort(); };
// the run in progress (also while a task is being graded, when no session is running): a panel opened
// again mid-run shows it
let progress: { results: BenchResult[]; current: { model: string; task: string } | null } | null = null;
export const benchmarkRunning = () => progress !== null;
export const benchmarkProgress = () => (progress ? { results: [...progress.results], current: progress.current } : null);

type Runner = (req: ChatRequest, emit: (e: AgentEvent) => void) => Promise<unknown> | unknown;

/**
 * Run every task for every model, one at a time, each in a fresh temp project — scoped to the task
 * (withRoot), so the app's own folder never changes: the editor, terminal and chat stay on the user's
 * project while it runs. `report` receives each verdict (FreeToken feedback).
 */
export async function runBenchmark(models: string[], run: Runner, onEvent: (e: BenchEvent) => void,
  report: (model: string, ok: boolean, reason: string) => void, opts: { maxSteps?: number; taskMs?: number; tasks?: BenchTask[] } = {}): Promise<BenchResult[]> {
  const tasks = opts.tasks ?? TASKS;
  const results: BenchResult[] = [];
  cancelled = false;
  progress = { results, current: null };
  try {
    for (const model of models) {
      for (const task of tasks) {
        if (cancelled) break;
        if (progress) progress.current = { model, task: task.id };
        onEvent({ type: "start", model, task: task.id });
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vrun-bench-${task.id}-`));
        for (const [f, t] of Object.entries(task.files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
        const sid = `bench-${model}-${task.id}-${Date.now()}`;
        running = sid;
        const t0 = Date.now();
        let steps = 0, tokens = 0, error = "";
        // FreeToken answers with another model when the one asked for is busy: that run says nothing about it
        const others = new Set<string>();
        const timer = setTimeout(() => getSession(sid).abort?.abort(), opts.taskMs ?? 240_000);
        await new Promise<void>((resolve) => {
          const emit = (e: AgentEvent) => {
            if (e.type === "approval") approve(sid, e.id, true); // a throwaway project: commands run without asking
            else if (e.type === "model" && e.model && e.model !== model) others.add(e.model);
            else if (e.type === "tool_start") steps++;
            else if (e.type === "usage") tokens += e.input + e.output;
            else if (e.type === "error") error = e.message;
            else if (e.type === "done") resolve();
          };
          withRoot(dir, () => Promise.resolve(run({ sessionId: sid, mode: "agent", text: task.prompt, model, maxSteps: opts.maxSteps ?? 25 }, emit))).catch((e) => { error = String(e); resolve(); });
        });
        clearTimeout(timer);
        running = null;
        const why = cancelled ? "cancelled" : await task.grade(dir).catch((e) => `grading failed: ${(e as Error).message}`) ?? null;
        // a failure the service caused (overloaded, out of quota, unreachable) says nothing about the model
        const serviceError = !!why && SERVICE_ERROR.test(error);
        const result: BenchResult = { model, task: task.id, ok: !why, why: why && error ? `${why} (${error.slice(0, 120)})` : why, ms: Date.now() - t0, steps, tokens,
          ...(others.size ? { fellBack: [...others] } : {}), ...(serviceError ? { serviceError: true } : {}) };
        results.push(result);
        onEvent({ type: "result", result });
        if (!cancelled && counts(result)) report(model, result.ok, `benchmark: ${task.id}${result.ok ? "" : ` — ${result.why}`}`);
        resetSession(sid);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      if (cancelled) break;
    }
  } finally {
    running = null;
    progress = null;
  }
  onEvent({ type: "done", results });
  return results;
}

/** Whether a run says something about the model: the model asked for did the work, and no service error stopped it. */
export const counts = (r: BenchResult) => !r.fellBack && !r.serviceError;
const SERVICE_ERROR = /overloaded|rate.?limit|quota|exhausted|temporarily|unavailable|try again|timed? ?out|can't reach|unreachable|network|\b(50[234]|429)\b/i;

/** Per model: tasks passed, total time, steps (only runs that count). */
export function summarise(results: BenchResult[]) {
  const by = new Map<string, { model: string; passed: number; total: number; ms: number; steps: number; tokens: number }>();
  for (const r of results.filter(counts)) {
    const m = by.get(r.model) ?? { model: r.model, passed: 0, total: 0, ms: 0, steps: 0, tokens: 0 };
    m.total++; if (r.ok) m.passed++; m.ms += r.ms; m.steps += r.steps; m.tokens += r.tokens;
    by.set(r.model, m);
  }
  return [...by.values()].sort((a, b) => b.passed / b.total - a.passed / a.total || a.ms - b.ms);
}
