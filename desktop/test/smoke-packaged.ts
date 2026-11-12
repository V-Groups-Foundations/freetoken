// The installed app, not the source: launches release/win-unpacked/V-Run.exe (npm run pack or npm run dist
// first) with a fresh profile and no AI set up, and checks the first-run screen, a new project from a
// starter, the real terminal and the command palette. Screenshots go to test/shots/packaged-*.png.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";

const exe = path.resolve(__dirname, "..", "release", process.platform === "win32" ? "win-unpacked/V-Run.exe" : "mac/V-Run.app/Contents/MacOS/V-Run");
const SHOTS = path.join(__dirname, "shots");

async function main() {
  if (!fs.existsSync(exe)) { console.log(`FAIL  no packaged app at ${exe} — run npm run pack first`); process.exit(1); }
  fs.mkdirSync(SHOTS, { recursive: true });
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-pkg-projects-"));
  const env: Record<string, string> = { ...(process.env as Record<string, string>), CURSOR_REMAKE_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "vrun-pkg-ud-")),
    VRUN_PROJECTS_DIR: projects, VRUN_NO_UPDATES: "1", VRUN_NO_CRASH_REPORTS: "1" };
  delete env.ANTHROPIC_API_KEY; delete env.FREETOKEN_API_TOKEN;
  const app = await electron.launch({ executablePath: exe, args: [], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failures = 0;
  async function step(name: string, fn: () => Promise<unknown>) {
    try { await fn(); console.log(`PASS  ${name}`); }
    catch (e) { failures++; console.log(`FAIL  ${name}\n      ${String((e as Error).message).split("\n").slice(0, 3).join("\n      ")}`); await page.screenshot({ path: path.join(SHOTS, `packaged-fail-${failures}.png`) }).catch(() => {}); }
  }

  await step("first run: no AI yet, so it offers Sign in with FreeToken and a Claude key", async () => {
    await page.locator(".vg-skip").click({ timeout: 5000 }).catch(() => {});
    await page.getByRole("button", { name: "Sign in with FreeToken (free)" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: /use your own Claude API key/ }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, "packaged-welcome.png") });
  });

  await step("a new project from the Website starter opens in the editor with its files", async () => {
    await page.getByText("New project", { exact: true }).click();
    await page.getByPlaceholder("Project name").fill("Smoke site");
    await page.getByRole("radio", { name: /Website/ }).click();
    await page.getByRole("button", { name: /^Create/ }).click();
    await page.getByText("index.html").first().waitFor({ timeout: 30_000 });
    if (!fs.existsSync(path.join(projects, "Smoke site", "index.html"))) throw new Error("starter files not written");
  });

  await step("the terminal is a real shell (xterm): a command runs in the project folder", async () => {
    await page.keyboard.press("Control+Backquote");
    const term = page.locator(".xterm-box .xterm");
    await term.waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500); // the shell starting
    await term.click();
    await page.keyboard.type(process.platform === "win32" ? "echo pty-$((Get-Location).Path.Length -gt 0)" : "echo pty-$(pwd | wc -c)");
    await page.keyboard.press("Enter");
    await page.locator(".xterm-rows", { hasText: /pty-(True|\s*\d+)/ }).waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(SHOTS, "packaged-terminal.png") });
  });

  await step("the command palette opens with Ctrl+Shift+P and runs a command", async () => {
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("dialog", { name: "Command palette" }).waitFor();
    await page.getByLabel("Command", { exact: true }).fill("settings");
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Command palette" }).waitFor({ state: "detached" });
    await page.getByText("Safety & limits").waitFor({ timeout: 10_000 });
  });

  await step("no errors in the window", async () => { if (errors.length) throw new Error(errors.join("\n")); });
  await app.close();
  console.log(failures ? `\n${failures} failed` : "\nall packaged-app checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
