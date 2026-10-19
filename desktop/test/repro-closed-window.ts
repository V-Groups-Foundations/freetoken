// Regression: closing the window while a debounced file-watch flush is pending must not throw
// "Object has been destroyed" in the main process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

async function main() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-closed-"));
  fs.writeFileSync(path.join(proj, "a.txt"), "a\n");
  const app = await electron.launch({
    args: ["."], cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ANTHROPIC_API_KEY: "", CURSOR_REMAKE_OPEN: proj, CURSOR_REMAKE_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "vrun-closed-ud-")) },
  });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "a.txt" }).waitFor({ timeout: 20000 });
  // keep the process alive after the window goes, and record uncaught errors instead of showing a dialog
  await app.evaluate(({ app }) => {
    (globalThis as any).__errs = [];
    process.on("uncaughtException", (e) => (globalThis as any).__errs.push(e.message));
    app.removeAllListeners("window-all-closed");
  });
  fs.writeFileSync(path.join(proj, "b.txt"), "changed\n"); // starts the 150 ms flush timer
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy());
  await new Promise((r) => setTimeout(r, 800));
  const errs = (await app.evaluate(() => (globalThis as any).__errs)) as string[];
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  console.log(errs.length ? `FAIL  ${errs.join(" | ")}` : "PASS  no main-process error after the window closed");
  process.exit(errs.length ? 1 : 0);
}
main();
