// Screenshots for the README: Team mode, the Skills panel, and paste/drop in the chat. Runs the real app
// against the scripted FreeToken server, in a throwaway project and V-Run home. Writes docs/screenshots/.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { startFakeOpenAI } from "./fake-openai";

const OUT = path.resolve(__dirname, "..", "..", "docs", "screenshots");
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

(async () => {
  // a small, realistic project
  const proj = tmp("shop-");
  fs.mkdirSync(path.join(proj, "src"));
  fs.writeFileSync(path.join(proj, "src", "hello.ts"), "export function greet(name: string) {\n  return `Hello ${name}`;\n}\n");
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "shopnest", scripts: { dev: "node server.js" } }, null, 2));
  fs.writeFileSync(path.join(proj, "README.md"), "# ShopNest\nA small online shop.\n");
  // a V-Run home with a few skills installed from GitHub (copied from this machine, if present) and one learned
  const home = tmp("vrun-home-");
  const mine = path.join(os.homedir(), ".v-run", "skills");
  for (const s of ["frontend-design", "pdf", "docx", "canvas-design"]) {
    if (fs.existsSync(path.join(mine, s, "SKILL.md"))) fs.cpSync(path.join(mine, s), path.join(home, "skills", s), { recursive: true });
  }
  fs.mkdirSync(path.join(home, "skills", "deploy-to-fly"), { recursive: true });
  fs.writeFileSync(path.join(home, "skills", "deploy-to-fly", "SKILL.md"), "---\nname: deploy-to-fly\ndescription: \"How this team deploys apps to Fly.io: fly launch, secrets, regions and health checks. Use when deploying to Fly.\"\n---\n\n1. fly launch --no-deploy\n2. fly secrets set …\n3. fly deploy\n");

  const fake = await startFakeOpenAI("ft_test");
  const app = await electron.launch({
    args: ["."], cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ANTHROPIC_API_KEY: "", CURSOR_REMAKE_PROVIDER: "freetoken", FREETOKEN_URL: fake.url, FREETOKEN_API_TOKEN: "ft_test",
      CURSOR_REMAKE_OPEN: proj, VRUN_HOME: home, VRUN_PROJECTS_DIR: tmp("vrun-ftprojects-"), CURSOR_REMAKE_USER_DATA: tmp("vrun-ud-") },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1500, 920); w.center(); });
    await page.getByRole("button", { name: "src", exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "src", exact: true }).click();
    await page.getByRole("button", { name: "hello.ts" }).click();
    const box = page.getByLabel("Message the AI");
    const shot = async (name: string) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, name) }); console.log("wrote", name); };

    // 1. Team mode
    await page.getByRole("radio", { name: "Team" }).click();
    await box.fill("Build the user page");
    await box.press("Enter");
    await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Accept all/ }).click();
    await page.locator(".msg-ai", { hasText: "Team finished" }).waitFor({ timeout: 30000 });
    const panel = page.getByRole("region", { name: "Team" });
    await panel.getByRole("button", { name: /web/ }).click();
    await shot("vrun-team.png");

    // 2. Skills panel
    await page.getByRole("button", { name: "New chat" }).click();
    await page.getByRole("button", { name: "Skills" }).click();
    await page.getByRole("dialog", { name: "Skills" }).locator(".skill-group").first().waitFor();
    await shot("vrun-skills.png");
    await page.getByRole("button", { name: "Close skills" }).click();

    // 3. Paste a screenshot + drop a file, and an automatically picked skill
    await page.getByRole("radio", { name: "Ask" }).click();
    const png = fs.readFileSync(path.join(OUT, "freetoken-home.png")).toString("base64");
    await box.evaluate((el, b64) => {
      const bin = atob(b64);
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], "image.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    const chat = page.getByRole("complementary", { name: "AI chat" });
    const drop = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(["name,price\nTea,3.50\nCoffee,4.00\n"], "prices.csv", { type: "text/csv" })); return dt; });
    await chat.dispatchEvent("dragover", { dataTransfer: drop });
    await page.getByText("Drop to attach").waitFor({ timeout: 3000 });
    await shot("vrun-drop.png");
    await chat.dispatchEvent("drop", { dataTransfer: drop });
    await page.locator(".chip.attach", { hasText: "prices.csv" }).waitFor();
    await box.fill("Build a landing page like this screenshot, with these prices");
    await box.press("Enter");
    await page.locator(".mem-note", { hasText: "Using skill" }).waitFor({ timeout: 15000 });
    await page.locator(".msg-ai").last().waitFor();
    await shot("vrun-attachments.png");
  } finally {
    await app.close();
    fake.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
