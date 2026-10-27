// Run a whole conversation through the real agent: npx tsx test/eval-chat.ts <scenario.json> [out-dir]
// A scenario is { name, files: { "path": "content" }, turns: [{ text, mode? }] }. Its files are written to a
// fresh folder, each turn goes through V-Run's FreeToken loop against your live FreeToken (auto-smart) in
// one session, commands are approved, Chrome is the preview pane, and every step is logged. The project
// folder is left behind (its path is printed) so what the agent changed can be checked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
(async () => {
  const scenario = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as { name: string; files: Record<string, string>; turns: { text: string; mode?: string }[] };
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), `vrun-chat-${scenario.name}-`));
  for (const [f, t] of Object.entries(scenario.files)) {
    fs.mkdirSync(path.dirname(path.join(proj, f)), { recursive: true });
    fs.writeFileSync(path.join(proj, f), t);
  }
  process.env.VRUN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-home-")); // only built-in skills
  const ws = await import("../src/main/workspace");
  const ft = await import("../src/main/ai-freetoken");
  const ai = await import("../src/main/ai");
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".freetoken", "config.json"), "utf8"));
  ft.configureFreeToken({ url: () => cfg.baseUrl, token: () => cfg.token, model: () => "auto-smart" });
  ws.setRoot(proj);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(runner.consoleLine(m.type(), m.text(), m.location().url)));
  page.on("pageerror", (e) => consoleLines.push(`[error] ${e.message}`));
  const runner = await import("../src/main/runner");
  // as in the app: FreeToken's own port isn't the project's
  runner.setProtectedPorts(() => [{ port: Number(new URL(cfg.baseUrl).port || 80), name: "FreeToken" }]);
  runner.setPreviewHost({
    async open(url) { consoleLines = []; try { await page.goto(url, { waitUntil: "load", timeout: 30000 }); await page.waitForTimeout(1500); } catch (e) { return (e as Error).message; } },
    async inspect() {
      if (!page.url() || page.url() === "about:blank") return null;
      const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      const jpeg = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => undefined);
      return { url: page.url(), title: await page.title(), text, console: consoleLines.slice(-40), jpeg } as any;
    },
    evaluate: (script) => page.evaluate(runner.probeScript(script)).then(String, (e) => `Error: ${(e as Error).message}`),
    setWidth: (width) => page.setViewportSize({ width: width ?? 1280, height: 800 }),
  });
  const t0 = Date.now();
  const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${s}`);
  // a fresh session per run: a rerun under the same name inherited the last run's model pin
  const sid = `eval-${scenario.name}-${Date.now()}`;
  console.log(`scenario ${scenario.name} in ${proj}`);
  for (const [i, turn] of scenario.turns.entries()) {
    console.log(`\n=== turn ${i + 1}${turn.mode ? ` (${turn.mode})` : ""}: ${turn.text}`);
    let text = "";
    const started = Date.now();
    await new Promise<void>((resolve) => ft.chatFreeToken({ sessionId: sid, mode: (turn.mode ?? "agent") as any, text: turn.text }, (e: any) => {
      if (e.type === "text") text += e.delta;
      else if (e.type === "model") log(`model ${e.model}${e.fallbacks ? ` (fell back from ${e.fallbacks})` : ""}`);
      else if (e.type === "tool_start") { if (text.trim()) log(`say: ${text.trim().slice(0, 400).replace(/\s+/g, " ")}`); text = ""; log(`tool ${e.name} ${String(JSON.stringify(e.input) ?? "(arguments were not valid JSON)").slice(0, 200)}`); }
      else if (e.type === "tool_end") log(`  → ${e.ok ? "" : "FAILED "}${String(e.summary).slice(0, 240)}`);
      else if (e.type === "approval") setTimeout(() => ai.approve(sid, e.id, true), 5);
      else if (e.type === "waiting") log(`waiting ${e.seconds}s (${e.reason})`);
      else if (e.type === "error") log(`ERROR ${e.message}`);
      else if (e.type === "done") { if (text.trim()) log(`final: ${text.trim().slice(0, 2500).replace(/\n+/g, " ⏎ ")}`); log(`done (${e.stopReason}) in ${((Date.now() - started) / 1000).toFixed(0)}s`); resolve(); }
    }));
  }
  if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], `${scenario.name}.png`) }).catch(() => {});
  await browser.close();
  await runner.stopAppAndWait();
  console.log(`\nproject left at ${proj}`);
  process.exit(0);
})();
