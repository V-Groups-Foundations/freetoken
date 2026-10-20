// End-to-end: the real Electron app talking to a (fake) FreeToken server through the UI.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright-core";
import { startFakeOpenAI } from "./fake-openai";

async function main() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-ftproj-"));
  fs.mkdirSync(path.join(proj, "src"));
  fs.writeFileSync(path.join(proj, "src/hello.ts"), "export function greet(name: string) {\n  return `Hello ${name}`;\n}\n");
  const fake = await startFakeOpenAI("ft_test");
  const ftProjects = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-ftprojects-"));
  const shots = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), "cursor-remake-ft-shots");
  fs.mkdirSync(shots, { recursive: true });
  const app = await electron.launch({
    args: ["."], cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ANTHROPIC_API_KEY: "", CURSOR_REMAKE_OPEN: proj, VRUN_PROJECTS_DIR: ftProjects, VRUN_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "vrun-home-")), CURSOR_REMAKE_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-ftud-")) },
  });
  const page = await app.firstWindow();
  // the FreeToken view is a separate WebContentsView; drive it like a user would
  const ftEval = (js: string) => app.evaluate(async ({ BrowserWindow, session }, code) => {
    const ftSession = session.fromPartition("persist:freetoken");
    const v = (BrowserWindow.getAllWindows()[0].contentView.children as any[]).find((x) => x.webContents.session === ftSession);
    return v ? v.webContents.executeJavaScript(code) : "no view";
  }, js);
  const ftGo = async (route: string) => {
    await ftEval(`location.href = ${JSON.stringify(route)}`).catch(() => {});
    for (let i = 0; i < 50; i++) { if ((await ftEval(`location.pathname`).catch(() => "")) === route) return; await page.waitForTimeout(100); }
    throw new Error(`FreeToken view did not reach ${route}`);
  };
  const ftClick = async (sel: string) => {
    await ftEval(`document.querySelector(${JSON.stringify(sel)}).click()`);
    for (let i = 0; i < 80; i++) {
      const t = await ftEval(`document.getElementById("out")?.textContent ?? ""`).catch(() => "");
      if (t) return t as string;
      await page.waitForTimeout(100);
    }
    return "";
  };
  let failures = 0;
  async function step(name: string, fn: () => Promise<unknown>) {
    try { await fn(); console.log(`PASS  ${name}`); }
    catch (e) { failures++; console.log(`FAIL  ${name}\n      ${String((e as Error).message).split("\n")[0]}`); await page.screenshot({ path: path.join(shots, `fail-${failures}.png`) }).catch(() => {}); }
  }
  try {
    await step("switch provider to FreeToken in Settings and test the connection", async () => {
      await page.getByRole("button", { name: "src", exact: true }).waitFor({ timeout: 20000 });
      await page.keyboard.press("Control+,");
      const dlg = page.getByRole("dialog", { name: "Settings" });
      await dlg.getByRole("radio", { name: "FreeToken" }).click();
      await dlg.getByPlaceholder("http://localhost:3000/api/v1").fill(fake.url);
      await dlg.getByLabel("FreeToken API token").fill("ft_test");
      await dlg.getByRole("button", { name: "Test connection" }).click();
      await dlg.getByRole("status").filter({ hasText: "Connected to FreeToken — 3 models" }).waitFor({ timeout: 10000 });
      await dlg.getByLabel("FreeToken model").selectOption("auto-smart");
      await dlg.getByRole("button", { name: "Save" }).click();
      await dlg.getByRole("status").filter({ hasText: "Saved" }).waitFor();
      await dlg.getByRole("button", { name: "Close" }).click();
      await page.getByText("FreeToken · auto-smart").waitFor({ timeout: 5000 });
    });
    await step("token is stored encrypted", async () => {
      const ud = (await app.evaluate(({ app }) => app.getPath("userData"))) as string;
      const raw = fs.readFileSync(path.join(ud, "settings.json"), "utf8");
      if (raw.includes("ft_test") || !JSON.parse(raw).ftTokenEnc) throw new Error("token not encrypted");
    });
    await step("agent chat runs through FreeToken: tools, approval, edit on disk", async () => {
      const box = page.getByLabel("Message the AI");
      await box.fill("Rename greet to sayHello");
      await box.press("Enter");
      // sending an Agent prompt first asks how to run it
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Step by step/ }).click();
      await page.getByRole("group", { name: "Command approval" }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Run all for this task" }).click();
      await page.locator(".msg-ai", { hasText: "via FreeToken" }).waitFor({ timeout: 15000 });
      // the second command ran without asking, and auto mode ended with the task
      await page.getByText("Auto-approved").waitFor({ timeout: 5000 });
      if (await page.getByRole("button", { name: "Run", exact: true }).count()) throw new Error("second command still waiting for approval");
      if (await page.getByText("Auto-running commands").count()) throw new Error("auto-run still on after the task finished");
      if (!fs.readFileSync(path.join(proj, "src/hello.ts"), "utf8").includes("sayHello(")) throw new Error("edit not applied");
      await page.getByText("2 files changed").waitFor();
      await page.screenshot({ path: path.join(shots, "freetoken-chat.png") });
    });
    await step("every chat request carried the ft_ token and tools", async () => {
      const r = fake.requests.filter((x) => x.tools);
      if (r.length < 5 || !r.every((x) => x.model === "auto-smart")) throw new Error(`${r.length} tool requests`);
    });
    await step("\"run the app\": agent starts it in the App panel, the page opens in Preview, and the agent reads it back", async () => {
      fs.writeFileSync(path.join(proj, "server.js"), `const h=require('http');const s=h.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end("<title>Test App</title><h1>Hello from test app</h1><script>console.error('boom from page')</script>")});s.listen(0,()=>console.log('Server ready at http://localhost:'+s.address().port));`);
      const box = page.getByLabel("Message the AI");
      await box.fill("Please run the app");
      await box.press("Enter");
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Step by step/ }).click();
      await page.getByRole("group", { name: "Command approval" }).filter({ hasText: "node server.js" }).getByRole("button", { name: "Run", exact: true }).click({ timeout: 15000 });
      await page.locator(".msg-ai", { hasText: "running in the preview" }).waitFor({ timeout: 30000 });
      await page.getByRole("tab", { name: "Preview", selected: true }).waitFor();
      const view = () => app.evaluate(({ BrowserWindow }) => {
        const v = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
        return v ? { url: v.webContents.getURL() as string, visible: typeof v.getVisible === "function" ? v.getVisible() as boolean : null, w: v.getBounds().width as number } : null;
      });
      const v1 = await view();
      if (!v1 || !/^http:\/\/localhost:\d+/.test(v1.url) || v1.visible === false || v1.w < 100) throw new Error(`preview: ${JSON.stringify(v1)}`);
      const sent = JSON.stringify(fake.requests.at(-1).messages.filter((m: any) => m.role === "tool"));
      if (!sent.includes("Hello from test app") || !sent.includes("boom from page")) throw new Error("page text/console not sent to the model");
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents.capturePage()).toPNG().toString("base64") as string);
      fs.writeFileSync(path.join(shots, "preview-page.png"), Buffer.from(png, "base64"));
      await page.keyboard.press("Control+,");
      await page.getByRole("dialog", { name: "Settings" }).waitFor();
      await page.waitForTimeout(300);
      if ((await view())?.visible) throw new Error("preview drawn over the Settings dialog");
      await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).click();
      await page.waitForTimeout(300);
      if ((await view())?.visible === false) throw new Error("preview not restored after closing Settings");
      // the preview must sit exactly on its box even when the editor UI is zoomed (Ctrl+=)
      const aligned = async () => {
        const box = await page.locator(".preview-host").boundingBox();
        const z = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
        const b = await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).getBounds());
        const off = Math.max(Math.abs(b.x - box!.x * z), Math.abs(b.y - box!.y * z), Math.abs(b.width - box!.width * z), Math.abs(b.height - box!.height * z));
        if (off > 2) throw new Error(`preview off its box by ${off.toFixed(0)}px at zoom ${z}: view ${JSON.stringify(b)} vs box ${JSON.stringify(box)}`);
      };
      await aligned();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
      await page.waitForTimeout(500);
      await aligned();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
      await page.waitForTimeout(300);
      // expand fills the editor area (editor hidden), restore brings it back; dragging the edge resizes
      const before = (await page.locator(".preview-host").boundingBox())!;
      await page.getByRole("button", { name: "Expand panel" }).click();
      await page.waitForTimeout(300);
      const big = (await page.locator(".preview-host").boundingBox())!;
      if (big.height < before.height + 100 || (await page.locator(".editor-area").isVisible())) throw new Error(`expand: ${before.height} → ${big.height}`);
      await aligned();
      await page.getByRole("button", { name: "Restore panel" }).click();
      await page.locator(".editor-area").waitFor();
      const handle = (await page.getByRole("separator", { name: "Resize panel" }).boundingBox())!;
      await page.mouse.move(handle.x + 50, handle.y + 3);
      await page.mouse.down();
      await page.mouse.move(handle.x + 50, handle.y - 120, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const taller = (await page.locator(".preview-host").boundingBox())!;
      if (Math.abs(taller.height - (before.height + 120)) > 8) throw new Error(`resize: ${before.height} → ${taller.height}`);
      await aligned();
      await page.getByRole("tab", { name: "App" }).click();
      await page.getByLabel("App output").filter({ hasText: "Server ready at http://localhost:" }).waitFor();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.getByLabel("App output").filter({ hasText: "[stopped]" }).waitFor();
      if (await page.getByRole("button", { name: "✦ Fix with AI" }).count()) throw new Error("Fix with AI offered after a manual stop");
      await page.screenshot({ path: path.join(shots, "app-panel.png") });
    });
    await step("a crashing app offers \"Fix with AI\", which sends the error to the chat", async () => {
      await page.getByLabel("App command").fill(`node -e "throw new Error('kaboom')"`);
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("button", { name: "✦ Fix with AI" }).click({ timeout: 15000 });
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Step by step/ }).click();
      await page.locator(".msg-user", { hasText: "kaboom" }).waitFor({ timeout: 5000 });
      // the model got the error; it then asks to re-run the app, which we skip
      await page.getByRole("group", { name: "Command approval" }).getByRole("button", { name: "Skip" }).click({ timeout: 15000 });
      if (!JSON.stringify(fake.requests.at(-1).messages).includes("kaboom")) throw new Error("error output not sent to the model");
      await page.getByRole("button", { name: "Send" }).waitFor({ timeout: 15000 });
    });
    await step("Plan mode: reasoning shown apart from the answer, plan approved and built, then rewound", async () => {
      await page.getByRole("button", { name: "New chat" }).click();
      await page.getByRole("radio", { name: "Plan" }).click();
      const box = page.getByLabel("Message the AI");
      await box.fill("Add a farewell helper");
      await box.press("Enter");
      await page.locator(".msg-ai", { hasText: "Add farewell in src/farewell.ts" }).waitFor({ timeout: 15000 });
      await page.getByText(/Thought for \d+s/).waitFor();
      if (await page.locator(".msg-ai", { hasText: "think" }).count()) throw new Error("reasoning leaked into the answer");
      const planReq = fake.requests.at(-1);
      if (planReq.tools.some((t: any) => t.function.name === "write_file")) throw new Error("plan mode exposed write_file");
      await page.screenshot({ path: path.join(shots, "plan.png") });
      await page.getByRole("button", { name: "▶ Approve plan & build" }).click();
      // Accept all: nothing else may ask until the job is done
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Accept all/ }).click();
      await page.locator(".msg-ai", { hasText: "Built the plan" }).waitFor({ timeout: 15000 });
      if (!(await page.getByRole("radio", { name: "Agent" }).getAttribute("aria-checked"))?.includes("true")) throw new Error("not switched to Agent");
      if (!fs.existsSync(path.join(proj, "src/farewell.ts"))) throw new Error("plan not built");
      // Accept all = no questions: the change is kept without a review bar
      await page.locator(".mem-note", { hasText: "Kept changes to 1 file" }).waitFor({ timeout: 5000 });
      if (await page.getByText(/files? changed/).count()) throw new Error("review bar shown after Accept all");
      await page.getByLabel("Suggested next steps").waitFor();
      // rewind: back to before "carry out the plan" — the new file goes away and the prompt returns for editing
      const msg = page.locator(".msg-user-wrap", { hasText: "carry out the plan" });
      await msg.hover();
      await msg.getByRole("button", { name: "Edit this message" }).click();
      await page.getByRole("button", { name: "Rewind & edit" }).click();
      await page.locator(".msg-ai", { hasText: "Built the plan" }).waitFor({ state: "detached", timeout: 5000 });
      if (fs.existsSync(path.join(proj, "src/farewell.ts"))) throw new Error("rewind did not remove the created file");
      if (!(await box.inputValue()).includes("carry out the plan")) throw new Error("prompt not restored for editing");
      const before = fake.requests.length;
      await box.fill("What is in hello.ts?");
      await box.press("Enter");
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Step by step/ }).click();
      await page.locator(".msg-ai", { hasText: "FreeToken says: What is in hello.ts?" }).waitFor({ timeout: 10000 });
      const sent = JSON.stringify(fake.requests.slice(before));
      if (sent.includes("Built the plan")) throw new Error("rewound turn still in the model's transcript");
    });
    await step("Team mode: a supervisor runs two agents in parallel, shown live in the Team panel; one review for the team", async () => {
      await page.getByRole("button", { name: "New chat" }).click();
      await page.getByRole("radio", { name: "Team" }).click();
      const box = page.getByLabel("Message the AI");
      await box.fill("Build the user page");
      await box.press("Enter");
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Step by step/ }).click();
      const panel = page.getByRole("region", { name: "Team" });
      await panel.waitFor({ timeout: 15000 });
      await panel.getByText(/2 agents/).waitFor({ timeout: 15000 });
      await page.locator(".msg-ai", { hasText: "Team finished" }).waitFor({ timeout: 30000 });
      await panel.getByText("all finished").waitFor({ timeout: 10000 });
      await panel.getByRole("button", { name: /web/ }).click();
      await panel.locator(".team-report", { hasText: "editing api.ts was BLOCKED" }).waitFor({ timeout: 5000 });
      await page.screenshot({ path: path.join(shots, "team.png") });
      const sup = fake.requests.find((r: any) => String(r.messages?.[0]?.content).includes("Team mode — you are the supervisor"));
      if (!sup?.tools.some((t: any) => t.function.name === "spawn_agent")) throw new Error("supervisor had no spawn_agent");
      const worker = fake.requests.find((r: any) => String(r.messages?.[0]?.content).includes('You are agent "web"'));
      if (!worker || worker.tools.some((t: any) => t.function.name === "spawn_agent")) throw new Error("worker could spawn agents");
      if (!fs.readFileSync(path.join(proj, "src/api.ts"), "utf8").includes("async per supervisor")) throw new Error("supervisor's answer didn't reach the api agent");
      // both agents' changes are in the supervisor chat's review
      const review = page.getByLabel("Files changed");
      await review.getByText("2 files changed").waitFor({ timeout: 10000 });
      if (!(await review.getByText("src/api.ts").count()) || !(await review.getByText("src/web.ts").count())) throw new Error("team changes missing from the review");
      await review.getByRole("button", { name: "Accept all" }).click();
    });

    await step("Settings → Open FreeToken shows the hub: projects, usage, providers and models from the account", async () => {
      fake.projects.set("p-hub", { name: "Hub project", model: "auto-smart", messages: [{ role: "user", content: "made on the web" }] });
      await page.keyboard.press("Control+,");
      const dlg = page.getByRole("dialog", { name: "Settings" });
      await dlg.getByRole("radio", { name: "FreeToken" }).click();
      await dlg.getByRole("button", { name: "Open FreeToken" }).click();
      const hub = page.getByRole("region", { name: "FreeToken" });
      await hub.getByText(/Connected · 127\.0\.0\.1/).waitFor({ timeout: 10000 });
      await hub.getByText("12.3k").waitFor(); // tokens today
      await hub.getByText("Hub project").waitFor();
      await hub.getByText("8 / 50").waitFor(); // OpenRouter account limit
      await hub.getByRole("button", { name: "groq/llama-3.3-70b" }).click();
      await page.getByText("FreeToken · groq/llama-3.3-70b").waitFor({ timeout: 5000 });
      await page.screenshot({ path: path.join(shots, "freetoken-hub.png") });
      await hub.getByRole("button", { name: "auto-smart" }).click();
      await page.getByText("FreeToken · auto-smart").waitFor({ timeout: 5000 });
    });
    await step("signing in uses the FreeToken page in V-Run, its bridge connects V-Run and returns to the hub", async () => {
      await page.evaluate(() => (window as any).api.ftOpen("/v-run"));
      await page.getByRole("region", { name: "FreeToken" }).getByText("FreeToken · sign in").waitFor({ timeout: 10000 });
      for (let i = 0; i < 50 && (await ftEval(`location.pathname`).catch(() => "")) !== "/v-run"; i++) await page.waitForTimeout(100);
      const res = await ftClick("#connect");
      if (res !== "connected") throw new Error(`bridge connect: ${res}`);
      await page.getByRole("region", { name: "FreeToken" }).getByText(/Connected · /).waitFor({ timeout: 10000 }); // back on the hub
      // "Back to V-Run" on a FreeToken page closes the tab
      await page.evaluate(() => (window as any).api.ftOpen("/"));
      for (let i = 0; i < 50 && (await ftEval(`location.pathname`).catch(() => "")) !== "/"; i++) await page.waitForTimeout(100);
      if ((await ftClick("#focus")) !== "focused") throw new Error("bridge focus failed");
      await page.getByRole("region", { name: "FreeToken" }).waitFor({ state: "detached", timeout: 5000 });
    });
    await step("hub: Open in V-Run continues a project; Create & open makes a new one", async () => {
      await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "FreeToken" }).click();
      const hub = page.getByRole("region", { name: "FreeToken" });
      await hub.getByRole("button", { name: "Open Hub project in V-Run" }).click();
      await page.getByLabel("Earlier in FreeToken").filter({ hasText: "made on the web" }).waitFor({ timeout: 10000 });
      if (!fs.existsSync(path.join(ftProjects, "Hub project", "project.json"))) throw new Error("hub project folder missing");
      await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "FreeToken" }).click();
      await hub.getByLabel("New project name").fill("Fresh idea");
      await hub.getByRole("button", { name: "Create & open" }).click();
      await page.getByRole("button", { name: /✦ Fresh idea/ }).waitFor({ timeout: 10000 });
      if (![...fake.projects.values()].some((p) => p.name === "Fresh idea")) throw new Error("project not created on the server");
    });
    await step("Continue in V-Run: project folder opens, the chat has the whole conversation, turns are saved back", async () => {
      fake.projects.set("p-todo", { name: "Todo app", model: "auto-smart", messages: [
        { role: "user", content: "Plan a todo app with dark mode" }, { role: "assistant", content: "Use React and a JSON file for storage.", provider: "groq/llama" },
      ] });
      await ftGo("/projects/p-todo");
      const res = await ftClick("#continue");
      if (res !== "opened") throw new Error(`continue: ${res}`);
      const dir = path.join(ftProjects, "Todo app");
      if (!fs.existsSync(path.join(dir, "project.json")) || !fs.readFileSync(path.join(dir, "transcript.md"), "utf8").includes("dark mode")) throw new Error("project folder not set up");
      await page.getByRole("button", { name: "transcript.md" }).waitFor({ timeout: 10000 });
      await page.getByLabel("Earlier in FreeToken").filter({ hasText: "Use React and a JSON file" }).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: /✦ Todo app/ }).waitFor();
      const box = page.getByLabel("Message the AI");
      await box.fill("Now build it");
      await box.press("Enter");
      await page.getByRole("group", { name: "How should the agent run this task?" }).getByRole("button", { name: /^Accept all/ }).click();
      await page.getByText("✓ saved to FreeToken").waitFor({ timeout: 15000 });
      const sent = JSON.stringify(fake.requests.at(-1).messages);
      if (!sent.includes("Use React and a JSON file") || !sent.includes("Now build it")) throw new Error("model did not get the project conversation");
      const saved = fake.projects.get("p-todo")!.messages;
      if (saved.at(-2)?.content !== "Now build it" || saved.at(-1)?.provider !== "v-run") throw new Error("turn not written back");
      await page.screenshot({ path: path.join(shots, "continued-project.png") });
    });
    await step("a vrun:// link opens the project too (as when clicked in a browser)", async () => {
      fake.projects.set("p-link", { name: "Link project", model: "auto-smart", messages: [{ role: "user", content: "hello from the web" }] });
      await app.evaluate(({ app }) => { app.emit("second-instance", {}, ["electron", ".", "vrun://project/p-link"], ""); });
      await page.getByLabel("Earlier in FreeToken").filter({ hasText: "hello from the web" }).waitFor({ timeout: 10000 });
      if (!fs.existsSync(path.join(ftProjects, "Link project", "project.json"))) throw new Error("folder not created");
    });
    await step("memory: '# note' saves to V.md, the Memory panel shows it, and the next request carries it", async () => {
      const box = page.getByLabel("Message the AI");
      await box.fill("# Always answer in British English");
      await page.getByText("Enter saves this note to V.md").waitFor();
      await box.press("Enter");
      await page.locator(".mem-note", { hasText: "Remembered in V.md: Always answer in British English" }).waitFor({ timeout: 5000 });
      const root = (await app.evaluate(async ({ BrowserWindow }) => (await (BrowserWindow.getAllWindows()[0].webContents.executeJavaScript("window.api.getFolder()"))).root)) as string;
      if (!fs.readFileSync(path.join(root, "V.md"), "utf8").includes("- Always answer in British English")) throw new Error("V.md not written");
      await page.getByRole("button", { name: /^Memory/ }).click();
      await page.getByRole("dialog", { name: "Memory" }).getByText("1 remembered item").waitFor();
      await page.getByRole("dialog", { name: "Memory" }).getByRole("button", { name: "Close memory" }).click();
      await page.getByRole("radio", { name: "Ask" }).click();
      await box.fill("What should I know?");
      await box.press("Enter");
      await page.locator(".msg-ai", { hasText: "FreeToken says: What should I know?" }).waitFor({ timeout: 10000 });
      if (!String(fake.requests.at(-1).messages[0].content).includes("Always answer in British English")) throw new Error("memory not in the system prompt");
      await page.getByRole("radio", { name: "Agent" }).click();
    });
    await step("switch folders: Ctrl+O opens another, Close folder returns to Welcome, Recent reopens", async () => {
      const other = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-other-"));
      fs.writeFileSync(path.join(other, "second.txt"), "hi\n");
      await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as any; }, other);
      await page.keyboard.press("Control+o");
      await page.getByRole("button", { name: "second.txt" }).waitFor({ timeout: 10000 });
      if (await page.getByRole("button", { name: "src", exact: true }).count()) throw new Error("old tree still shown");
      await page.getByRole("button", { name: "Close folder" }).click();
      await page.getByRole("button", { name: "Open folder…" }).waitFor();
      await page.getByRole("button", { name: proj }).click();
      await page.getByRole("button", { name: "src", exact: true }).waitFor({ timeout: 10000 });
    });
  } finally {
    await app.close();
    fake.close();
  }
  console.log(failures ? `\n${failures} step(s) failed` : `\nall FreeToken e2e steps passed — screenshot in ${shots}`);
  process.exit(failures ? 1 : 0);
}
main();
