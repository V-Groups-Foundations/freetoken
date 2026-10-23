// Benchmark real models through your live FreeToken from the command line: npx tsx test/eval-bench.ts [provider/model ...]
// (default: the first two of your models). Uses their free quota and sends the verdicts to FreeToken.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
(async () => {
  const ft = await import("../src/main/ai-freetoken");
  const bench = await import("../src/main/bench");
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".freetoken", "config.json"), "utf8"));
  ft.configureFreeToken({ url: () => cfg.baseUrl, token: () => cfg.token, model: () => "auto-smart" });
  const all = (await ft.listModels()).filter((m) => !/^auto-/.test(m));
  console.log("models:", all.length, all.slice(0, 12).join(", "));
  const before = await ft.routerScores("agent");
  console.log("ranking before:", before?.models.slice(0, 5).map((m) => `${m.model} ${m.score}${m.learned ? ` (${m.learned})` : ""}`).join(" | "));
  const pick = process.argv.slice(2).length ? process.argv.slice(2) : all.slice(0, 2);
  const t0 = Date.now();
  const results = await bench.runBenchmark(pick, (req, emit) => ft.chatFreeToken(req, emit),
    (e) => { if (e.type === "result") console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${e.result.model} ${e.result.task}: ${e.result.fellBack ? `NOT COUNTED — answered by ${e.result.fellBack.join(", ")}` : e.result.serviceError ? `NOT COUNTED — service error: ${e.result.why}` : e.result.ok ? "PASS" : `FAIL — ${e.result.why}`} (${e.result.steps} steps, ${Math.round(e.result.ms / 1000)}s)`); },
    (m, ok, reason) => ft.reportModel(m, ok, reason));
  console.log("summary:", JSON.stringify(bench.summarise(results).map((s) => [s.model, `${s.passed}/${s.total}`])));
  await new Promise((r) => setTimeout(r, 2000));
  const after = await ft.routerScores("agent");
  console.log("ranking after:", after?.models.slice(0, 5).map((m) => `${m.model} ${m.score}${m.learned ? ` (${m.learned})` : ""}`).join(" | "));
  process.exit(0);
})();
