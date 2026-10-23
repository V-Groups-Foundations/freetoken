// Benchmark: every grader passes a correct solution and fails the untouched task; a run scores a
// "perfect" stand-in model and a "do nothing" one correctly, reports each verdict, restores the project.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ws from "../src/main/workspace";
import * as bench from "../src/main/bench";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}

// what a model that gets everything right would write
const SOLUTIONS: Record<string, Record<string, string>> = {
  "fix-bug": { "cart.js": "function total(items) { let s = 0; for (let i = 0; i < items.length; i++) s += items[i].price * items[i].qty; return s; }\nmodule.exports = { total };\n" },
  "new-program": { "stats.js": "const n = require('fs').readFileSync(__dirname + '/numbers.txt', 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean).map(Number);\nconsole.log(`sum=${n.reduce((a, b) => a + b, 0)} max=${Math.max(...n)}`);\n" },
  rename: {
    "util.js": "function computeScore(a, b) {\n  return a * b + 1;\n}\nmodule.exports = { computeScore };\n",
    "main.js": "const { computeScore } = require('./util');\nconsole.log(computeScore(3, 4));\n",
    "report.js": "const util = require('./util');\nmodule.exports = () => `value: ${util.computeScore(2, 2)}`;\n",
  },
  feature: {
    "todo.js": "class Todos {\n  constructor() { this.items = []; }\n  add(text) { this.items.push({ text, done: false }); return this.items.length - 1; }\n  complete(i) { this.items[i].done = true; }\n  remaining() { return this.items.filter((t) => !t.done).length; }\n}\nmodule.exports = { Todos };\n",
    "test.js": "const assert = require('assert'); const { Todos } = require('./todo'); const t = new Todos(); t.add('a'); t.add('b'); t.add('c'); t.complete(1); assert.strictEqual(t.remaining(), 2); console.log('ok');\n",
  },
  "distant-bug": { "parse.js": "function parseDate(s) {\n  const [y, m, d] = s.split('-').map(Number);\n  return { y, m, d };\n}\nmodule.exports = { parseDate };\n" },
  "read-the-error": { "report.js": "const { loadOrders } = require('./data');\nasync function main() {\n  const orders = await loadOrders();\n  console.log(orders.map((o) => `#${o.id}: ${o.total.toFixed(2)}`).join('\\n'));\n  console.log('total: ' + orders.reduce((s, o) => s + o.total, 0).toFixed(2));\n}\nmain();\n" },
  "small-cli": { "notes.js": "const fs = require('fs'); const path = require('path');\nconst file = path.join(__dirname, 'notes.json');\nconst notes = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];\nconst save = () => fs.writeFileSync(file, JSON.stringify(notes));\nconst [cmd, ...rest] = process.argv.slice(2);\nif (cmd === 'add') { notes.push(rest.join(' ')); save(); console.log(`added #${notes.length}`); }\nelse if (cmd === 'list') notes.forEach((n, i) => console.log(`${i + 1}. ${n}`));\nelse if (cmd === 'done') { const n = Number(rest[0]); if (!notes[n - 1]) { console.log(`no note #${n}`); process.exit(1); } notes.splice(n - 1, 1); save(); console.log(`removed #${n}`); }\n" },
  // answering is the whole task: the right "solution" changes nothing
  "stay-in-scope": {},
};
/** What a model that oversteps would do to a task whose right answer is to change nothing. */
const OVERSTEP: Record<string, Record<string, string>> = { "stay-in-scope": { "server.js": "const PORT = process.env.PORT || 8080;\n" } };
const setup = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-grade-"));
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t);
  return dir;
};

(async () => {
  await check("each grader passes a correct solution and fails the untouched task", async () => {
    const bad: string[] = [];
    for (const t of bench.TASKS) {
      const wrong = await t.grade(setup({ ...t.files, ...(OVERSTEP[t.id] ?? {}) }));
      const solved = await t.grade(setup({ ...t.files, ...SOLUTIONS[t.id] }));
      if (wrong === null) bad.push(`${t.id}: ${OVERSTEP[t.id] ? "overstepping" : "the untouched task"} passes`);
      if (solved !== null) bad.push(`${t.id}: the solution fails — ${solved}`);
    }
    return bad.length ? bad.join("\n      ") : true;
  });

  await check("a run scores a perfect model and a do-nothing model, reports every verdict, and restores the project", async () => {
    const userProject = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-user-"));
    ws.setRoot(userProject);
    const reports: string[] = [];
    const events: string[] = [];
    const run = async (req: any, emit: (e: any) => void) => {
      emit({ type: "tool_start", id: "1", name: "write_file", input: {} });
      seenByTask.add(fs.realpathSync(ws.getRoot()!));
      const pr = bench.benchmarkProgress();
      if (pr?.current?.model === req.model) progressSeen++;
      if (req.model === "good/model") {
        const task = bench.TASKS.find((t) => t.prompt === req.text)!;
        for (const [f, t] of Object.entries(SOLUTIONS[task.id])) fs.writeFileSync(path.join(ws.getRoot()!, f), t);
      }
      emit({ type: "usage", input: 100, output: 20 });
      emit({ type: "done", stopReason: "stop" });
    };
    // the rest of the app (editor, terminal, chat) checks the folder while the benchmark runs
    const seenByApp = new Set<string>();
    const seenByTask = new Set<string>();
    let progressSeen = 0, runningAtResult = 0;
    const watch = setInterval(() => seenByApp.add(fs.realpathSync(ws.getRoot()!)), 2);
    const results = await bench.runBenchmark(["good/model", "lazy/model"], run, (e) => { events.push(e.type); if (e.type === "result" && bench.benchmarkRunning()) runningAtResult++; }, (m, ok) => reports.push(`${m}:${ok}`));
    clearInterval(watch);
    const sum = bench.summarise(results);
    const restored = fs.realpathSync(ws.getRoot()!) === fs.realpathSync(userProject);
    const appStayed = seenByApp.size === 1 && seenByApp.has(fs.realpathSync(userProject));
    const taskScoped = seenByTask.size === 2 * bench.TASKS.length && !seenByTask.has(fs.realpathSync(userProject));
    if (!appStayed || !taskScoped) return JSON.stringify({ app: [...seenByApp], task: seenByTask.size });
    // a panel opened mid-run sees the run (also while grading), and nothing once it's over
    if (progressSeen !== 2 * bench.TASKS.length || runningAtResult !== 2 * bench.TASKS.length || bench.benchmarkProgress() !== null || bench.benchmarkRunning()) return JSON.stringify({ progressSeen, runningAtResult, after: bench.benchmarkProgress() });
    // doing nothing is right only where the task is to change nothing
    const n = bench.TASKS.length, lazyRight = bench.TASKS.filter((t) => OVERSTEP[t.id]).length;
    return (results.length === 2 * n && sum[0].model === "good/model" && sum[0].passed === n && sum[1].passed === lazyRight && restored
      && reports.filter((r) => r === "good/model:true").length === n && reports.filter((r) => r === "lazy/model:false").length === n - lazyRight
      && events.at(-1) === "done" && results.every((r) => r.steps === 1 && r.tokens === 120))
      || JSON.stringify({ sum, restored, reports, why: results.filter((r) => r.model === "good/model" && !r.ok).map((r) => r.why) });
  });

  await check("a run answered by another model (the one asked for was busy) isn't counted for the model asked for", async () => {
    const reports: string[] = [];
    const run = async (req: any, emit: (e: any) => void) => {
      emit({ type: "model", model: req.model === "busy/model" ? "other/model" : req.model });
      emit({ type: "done", stopReason: "stop" });
    };
    const one = [bench.TASKS.find((t) => t.id === "stay-in-scope")!];
    const results = await bench.runBenchmark(["busy/model", "free/model"], run, () => {}, (m, ok) => reports.push(`${m}:${ok}`), { tasks: one });
    return (reports.join() === "free/model:true" && results[0].fellBack?.join() === "other/model" && !results[1].fellBack) || JSON.stringify({ reports, results });
  });

  await check("a run stopped by the service (overloaded, out of quota) isn't counted against the model; its own mistakes are", async () => {
    const reports: string[] = [];
    const run = async (req: any, emit: (e: any) => void) => {
      emit({ type: "model", model: req.model });
      emit({ type: "error", message: req.model === "busy/model" ? "FreeToken error : Service temporarily overloaded"
        // a refusal whose request id happens to contain "502" is still the model's (or the format's) problem
        : "FreeToken error 400: AiError: Bad input: Type mismatch (0252bdeb-b019)" });
      emit({ type: "done", stopReason: "error" });
    };
    const one = [bench.TASKS.find((t) => t.id === "fix-bug")!];
    const results = await bench.runBenchmark(["busy/model", "sloppy/model"], run, () => {}, (m, ok) => reports.push(`${m}:${ok}`), { tasks: one });
    const sum = bench.summarise(results);
    return (reports.join() === "sloppy/model:false" && results[0].serviceError === true && sum.length === 1 && sum[0].model === "sloppy/model") || JSON.stringify({ reports, results, sum });
  });

  console.log(failures ? `\n${failures} failed` : "\nall benchmark checks passed");
  process.exit(failures ? 1 : 0);
})();
