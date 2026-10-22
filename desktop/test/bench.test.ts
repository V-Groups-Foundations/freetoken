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
};
const setup = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-grade-"));
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t);
  return dir;
};

(async () => {
  await check("each grader passes a correct solution and fails the untouched task", async () => {
    const bad: string[] = [];
    for (const t of bench.TASKS) {
      const untouched = await t.grade(setup(t.files));
      const solved = await t.grade(setup({ ...t.files, ...SOLUTIONS[t.id] }));
      if (untouched === null) bad.push(`${t.id}: the untouched task passes`);
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
    const watch = setInterval(() => seenByApp.add(fs.realpathSync(ws.getRoot()!)), 2);
    const results = await bench.runBenchmark(["good/model", "lazy/model"], run, (e) => events.push(e.type), (m, ok) => reports.push(`${m}:${ok}`));
    clearInterval(watch);
    const sum = bench.summarise(results);
    const restored = fs.realpathSync(ws.getRoot()!) === fs.realpathSync(userProject);
    const appStayed = seenByApp.size === 1 && seenByApp.has(fs.realpathSync(userProject));
    const taskScoped = seenByTask.size === 8 && !seenByTask.has(fs.realpathSync(userProject));
    if (!appStayed || !taskScoped) return JSON.stringify({ app: [...seenByApp], task: seenByTask.size });
    return (results.length === 8 && sum[0].model === "good/model" && sum[0].passed === 4 && sum[1].passed === 0 && restored
      && reports.filter((r) => r === "good/model:true").length === 4 && reports.filter((r) => r === "lazy/model:false").length === 4
      && events.at(-1) === "done" && results.every((r) => r.steps === 1 && r.tokens === 120))
      || JSON.stringify({ sum, restored, reports, why: results.filter((r) => r.model === "good/model" && !r.ok).map((r) => r.why) });
  });

  console.log(failures ? `\n${failures} failed` : "\nall benchmark checks passed");
  process.exit(failures ? 1 : 0);
})();
