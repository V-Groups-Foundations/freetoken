// End-to-end: launches the built Electron app against the fake Messages API and a temp project.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type Page } from "playwright-core";
import { demoScript, startFake } from "./fake-anthropic";

const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "cursor-remake-shots");
fs.mkdirSync(SHOTS, { recursive: true });

async function main() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-proj-"));
  const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true }); fs.writeFileSync(path.join(proj, rel), text); };
  w("src/hello.ts", "export function greet(name: string) {\n  return `Hello ${name}`;\n}\n");
  w("src/math.ts", "export function add(a, b) {\n  return a + b;\n}\n");
  w("README.md", "# Demo project\n");
  const fake = await startFake(demoScript);

  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ANTHROPIC_BASE_URL: fake.url, ANTHROPIC_API_KEY: "test-key",
      CURSOR_REMAKE_OPEN: proj, CURSOR_REMAKE_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-ud-")) },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  let current = "";
  page.on("pageerror", (e) => errors.push(`${e.message} (during "${current}")${process.env.E2E_DEBUG ? `
${e.stack}` : ""}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${m.text()} (during "${current}")`); });

  let failures = 0;
  const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  async function step(name: string, fn: () => Promise<unknown>) {
    current = name;
    try { await fn(); console.log(`PASS  ${name}`); }
    catch (e) { failures++; console.log(`FAIL  ${name}\n      ${String((e as Error).message).split("\n").slice(0, 4).join("\n      ")}`); await shot(`fail-${failures}`).catch(() => {}); if (process.env.E2E_STOP) throw e; }
  }
  const editorText = (p: Page) => p.locator(".editor-wrap .view-lines").innerText();

  try {
    await step("app opens the folder, shows the tree and indexes", async () => {
      await page.getByRole("button", { name: "src", exact: true }).waitFor({ timeout: 20000 });
      await page.getByText(/Indexed \d+ files/).waitFor({ timeout: 20000 });
    });

    await step("open a file from the tree into Monaco", async () => {
      await page.getByRole("button", { name: "src", exact: true }).click();
      await page.getByRole("button", { name: "hello.ts", exact: true }).click();
      await page.locator(".editor-wrap .view-lines", { hasText: "greet" }).waitFor({ timeout: 15000 });
    });

    await step("edit + Ctrl+S saves to disk", async () => {
      await page.locator(".editor-wrap .view-lines").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type("// saved by e2e");
      await page.keyboard.press("Control+S");
      await page.waitForTimeout(400);
      if (!fs.readFileSync(path.join(proj, "src/hello.ts"), "utf8").includes("// saved by e2e")) throw new Error("not saved");
    });

    await step("Ctrl+P quick open", async () => {
      await page.keyboard.press("Control+P");
      await page.getByLabel("File name").fill("math");
      await page.keyboard.press("Enter");
      await page.locator(".tab.active", { hasText: "math.ts" }).waitFor();
    });

    await step("Ctrl+K inline edit → diff → accept", async () => {
      await page.locator(".editor-wrap .view-lines").click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Control+K");
      await page.getByPlaceholder(/Describe the change/).fill("add number types");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Accept" }).click({ timeout: 15000 });
      await page.waitForFunction(() => (document.querySelector(".editor-wrap .view-lines")?.textContent ?? "").replace(/[\u00a0\u00b7]/g, " ").includes("b: number): number"), null, { timeout: 5000 });
      await shot("01-cmdk-applied");
    });

    await step("Tab completion shows ghost text and Tab accepts it", async () => {
      await page.locator(".editor-wrap .view-lines").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("const total = ");
      await page.locator(".ghost-text-decoration, .ghost-text").first().waitFor({ timeout: 8000 });
      await page.keyboard.press("Tab");
      await page.waitForFunction(() => (document.querySelector(".editor-wrap .view-lines")?.textContent ?? "").replace(/[\u00a0\u00b7]/g, " ").includes("const total = a + b;"), null, { timeout: 5000 });
    });

    await step("agent: searches, edits, asks to run a command, finishes", async () => {
      const box = page.getByLabel("Message the AI");
      await box.fill("Rename greet to sayHello");
      await box.press("Enter");
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Step by step/ }).click();
      await page.getByRole("group", { name: "Command approval" }).waitFor({ timeout: 15000 });
      await shot("02-agent-approval");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.locator(".msg-ai", { hasText: "Renamed" }).waitFor({ timeout: 15000 });
      await page.getByLabel("Agent plan").waitFor();
      if (!fs.readFileSync(path.join(proj, "src/hello.ts"), "utf8").includes("sayHello")) throw new Error("edit not on disk");
    });

    await step("open tab reloads with the agent's edit", async () => {
      await page.locator(".tab", { hasText: "hello.ts" }).click();
      await page.locator(".editor-wrap .view-lines", { hasText: "sayHello" }).waitFor({ timeout: 5000 });
    });

    await step("review bar lists changed files; diff view; reject restores, accept keeps", async () => {
      await page.getByText("2 files changed").waitFor({ timeout: 5000 });
      await page.getByRole("button", { name: "src/hello.ts", exact: true }).click();
      await page.getByText("Review:").waitFor();
      await shot("03-review-diff");
      await page.getByRole("button", { name: "Reject", exact: true }).click();
      await page.getByRole("button", { name: "Accept NOTES.md" }).click();
      await page.getByText(/files? changed/).waitFor({ state: "detached", timeout: 5000 });
      const hello = fs.readFileSync(path.join(proj, "src/hello.ts"), "utf8");
      if (!hello.includes("function greet(") || !fs.existsSync(path.join(proj, "NOTES.md"))) throw new Error("reject/accept wrong");
    });

    await step("ask mode answers without tools that modify", async () => {
      await page.getByRole("radio", { name: "Ask" }).click();
      const box = page.getByLabel("Message the AI");
      await box.fill("What does math.ts do?");
      await box.press("Enter");
      await page.locator(".msg-ai", { hasText: "You asked: What does math.ts do?" }).waitFor({ timeout: 10000 });
      const req = fake.requests.at(-1);
      if (req.tools.some((t: any) => t.name === "edit_file")) throw new Error("ask mode exposed edit_file");
    });

    await step("@ mention attaches a file to the message", async () => {
      const box = page.getByLabel("Message the AI");
      await box.fill("explain @READ");
      await page.locator(".mention-pop button", { hasText: "README.md" }).click();
      await box.press("Enter");
      await page.locator(".msg-user .chip", { hasText: "@README.md" }).waitFor();
      await page.waitForTimeout(500);
      const body = JSON.stringify(fake.requests.at(-1).messages);
      if (!body.includes("# Demo project")) throw new Error("file content not sent");
    });

    await step("project search finds text", async () => {
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByLabel("Search text").fill("return a + b");
      await page.keyboard.press("Enter");
      await page.locator(".hit-file", { hasText: "src/math.ts" }).waitFor({ timeout: 5000 });
    });

    await step("terminal runs a command", async () => {
      await page.keyboard.press("Control+`");
      await page.getByLabel("Terminal command").fill("echo terminal-ok");
      await page.keyboard.press("Enter");
      await page.locator('section[aria-label="Terminal"] pre', { hasText: "[exit 0]" }).waitFor({ timeout: 15000 });
      if (!(await page.locator('section[aria-label="Terminal"] pre').innerText()).includes("terminal-ok")) throw new Error("no output");
      await shot("04-workbench");
    });

    await step("Ctrl+= / Ctrl+- / Ctrl+0 zoom the window (there's no menu to carry them)", async () => {
      const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
      await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press("Control+=");
      await page.waitForTimeout(200);
      const bigger = await zoom();
      await page.keyboard.press("Control+-");
      await page.keyboard.press("Control+-");
      await page.waitForTimeout(200);
      const smaller = await zoom();
      await page.keyboard.press("Control+0");
      await page.waitForTimeout(200);
      const reset = await zoom();
      if (!(bigger > 0 && smaller < 0 && reset === 0)) throw new Error(JSON.stringify({ bigger, smaller, reset }));
    });
    await step("settings stores the API key encrypted", async () => {
      await page.keyboard.press("Control+,");
      await page.getByRole("dialog", { name: "Settings" }).getByPlaceholder(/sk-ant|ANTHROPIC_API_KEY/).fill("sk-ant-test-123");
      await page.getByRole("button", { name: "Save" }).click();
      await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
      const ud = (await app.evaluate(({ app }) => app.getPath("userData"))) as string;
      const raw = fs.readFileSync(path.join(ud, "settings.json"), "utf8");
      if (raw.includes("sk-ant-test-123") || !JSON.parse(raw).apiKeyEnc) throw new Error("key not encrypted");
    });

    await step("no renderer errors", async () => {
      const real = errors.filter((e) => !/Autofill|DevTools|Electron Security Warning/i.test(e));
      if (real.length) throw new Error(real.slice(0, 3).join(" | "));
    });
  } finally {
    await app.close();
    fake.close();
  }
  console.log(failures ? `\n${failures} step(s) failed — screenshots in ${SHOTS}` : `\nall e2e steps passed — screenshots in ${SHOTS}`);
  process.exit(failures ? 1 : 0);
}
main();
