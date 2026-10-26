// Evaluate the real agent on a real task: npx tsx test/eval-agent.ts <project copy> "<request>" [mode] [saved agent-*.json to continue] [final screenshot.png]
// It runs V-Run's FreeToken loop against your live FreeToken (auto-smart), auto-approves commands, uses Chrome as the preview pane, and logs every step.
// Run V-Run's real agent loop (FreeToken, auto-smart) on a copy of the user's project and log every step.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
(async () => {
  const proj = process.argv[2], request = process.argv[3], mode = (process.argv[4] ?? "agent") as any;
  process.env.VRUN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-home-")); // only built-in skills
  const ws = await import("../src/main/workspace");
  const ft = await import("../src/main/ai-freetoken");
  const ai = await import("../src/main/ai");
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".freetoken", "config.json"), "utf8"));
  ft.configureFreeToken({ url: () => cfg.baseUrl, token: () => cfg.token, model: () => "auto-smart" });
  ws.setRoot(proj);
  // continue the user's real conversation (everything before their latest message)
  if (process.argv[5]) {
    const saved = JSON.parse(fs.readFileSync(process.argv[5], "utf8")).ft as any[];
    const lastUser = saved.map((m) => m.role).lastIndexOf("user");
    ft.restoreTranscript("eval", saved.slice(0, lastUser));
    console.log(`(continuing a ${lastUser}-message conversation)`);
  }
  // a real browser as the preview pane (what V-Run shows), so the agent can see its page and console
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(`[${m.type() === "warning" ? "warning" : m.type()}] ${m.text().slice(0, 300)}`));
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
  let text = "";
  const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${s}`);
  await new Promise<void>((resolve) => ft.chatFreeToken({ sessionId: "eval", mode, text: request }, (e: any) => {
    if (e.type === "text") text += e.delta;
    else if (e.type === "tool_start") { if (text.trim()) log(`say: ${text.trim().slice(0, 220).replace(/\s+/g, " ")}`); text = ""; log(`tool ${e.name} ${String(JSON.stringify(e.input) ?? "(arguments were not valid JSON)").slice(0, 160)}`); }
    else if (e.type === "tool_end") log(`  → ${e.ok ? "" : "FAILED "}${e.summary.slice(0, 200)}`);
    else if (e.type === "approval") setTimeout(() => ai.approve("eval", e.id, true), 5);
    else if (e.type === "skills_used") log(`skills: ${e.names.join(", ")}`);
    else if (e.type === "error") log(`ERROR ${e.message}`);
    else if (e.type === "done") { if (text.trim()) log(`final: ${text.trim().slice(0, 1500).replace(/\n+/g, " ⏎ ")}`); log(`done (${e.stopReason})`); resolve(); }
  }));
  await page.screenshot({ path: process.argv[6] ?? "final.png" }).catch(() => {});
  console.log("preview console at the end:", consoleLines.filter((l) => l.startsWith("[error]")).slice(-5).join(" | ") || "no errors");
  await browser.close();
  await runner.stopAppAndWait();
  process.exit(0);
})();
