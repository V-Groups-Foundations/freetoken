// V-Run ⇄ FreeToken: deep links, continuing a project (folder, transcript, seeded agent), writing turns
// back, plus the runner/agent fixes for quiet servers. Uses the fake FreeToken server; no Electron.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeOpenAI } from "./fake-openai";

async function main() {
  const fake = await startFakeOpenAI("ft_test");
  const link = await import("../src/main/freetoken-link");
  const ai = await import("../src/main/ai");
  const ftAi = await import("../src/main/ai-freetoken");
  const runner = await import("../src/main/runner");
  const ws = await import("../src/main/workspace");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-link-"));

  let failures = 0;
  async function check(name: string, fn: () => unknown | Promise<unknown>) {
    try { const r = await fn(); if (r === false) throw new Error("returned false"); console.log(`PASS  ${name}`); }
    catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
  }

  await check("vrun:// links: only project/<id> with a safe id is accepted", () =>
    link.parseDeepLink("vrun://open")?.kind === "open" && link.parseDeepLink("vrun://open/x") === null
    && (link.parseDeepLink("vrun://project/abc-123") as { id: string })?.id === "abc-123"
    && (link.parseDeepLink("vrun://project/abc-123/") as { id: string })?.id === "abc-123"
    && link.parseDeepLink("vrun://project/../etc") === null
    && link.parseDeepLink("vrun://evil/abc") === null
    && link.parseDeepLink("https://project/abc") === null);

  await check("folder names match the FreeToken CLI", () =>
    link.sanitizeFolderName('My: "App"?') === "My- -App" && link.sanitizeFolderName("...") === "project");

  fake.projects.set("p1", { name: "Todo app", model: "auto-smart", messages: [
    { role: "user", content: "Plan a todo app" }, { role: "assistant", content: "Use React + a JSON file.", provider: "groq/llama" },
    { role: "user", content: "Also add dark mode" },
  ] });

  let project: Awaited<ReturnType<typeof link.loadProject>>;
  await check("loadProject fetches the conversation and sets up Desktop/FreeToken/<name>", async () => {
    project = await link.loadProject(fake.url, "ft_test", "p1", { root: tmp });
    const meta = JSON.parse(fs.readFileSync(path.join(project.dir, "project.json"), "utf8"));
    const transcript = fs.readFileSync(path.join(project.dir, "transcript.md"), "utf8");
    return project.dir === path.join(tmp, "Todo app") && meta.id === "p1" && project.messages.length === 3
      && transcript.includes("**You:** Plan a todo app") && transcript.includes("**groq/llama:** Use React");
  });

  await check("bad token and unknown project give clear errors", async () => {
    const bad = await link.loadProject(fake.url, "ft_wrong", "p1", { root: tmp }).catch((e: Error) => e.message);
    const missing = await link.loadProject(fake.url, "ft_test", "nope", { root: tmp }).catch((e: Error) => e.message);
    const none = await link.loadProject(fake.url, "", "p1", { root: tmp }).catch((e: Error) => e.message);
    return String(bad).includes("didn't accept") && String(missing).includes("doesn't exist") && String(none).includes("Connect V-Run");
  });

  await check("seeded session: strictly alternating, starts with the intro, ends on the assistant", () => {
    const turns = ai.seedSession("seed", project.messages, "[from FreeToken]");
    ftAi.seedFreeToken("seed", turns);
    const roles = turns.map((t) => t.role).join(",");
    return roles === "user,assistant,user,assistant" && turns[0].content.startsWith("[from FreeToken]\n\nPlan a todo app")
      && turns[3].content === "(no reply yet)" && ai.getSession("seed").messages.length === 4;
  });

  await check("the next FreeToken request carries the whole project conversation", async () => {
    ws.setRoot(project.dir);
    ftAi.configureFreeToken({ url: () => fake.url, token: () => "ft_test", model: () => "auto-smart" });
    const done = new Promise<void>((r) => ftAi.chatFreeToken({ sessionId: "seed", mode: "ask", text: "what did we decide?" }, (e) => e.type === "done" && r()));
    await done;
    const sent = JSON.stringify(fake.requests.at(-1).messages);
    return sent.includes("Use React + a JSON file.") && sent.includes("Also add dark mode") && sent.includes("what did we decide?");
  });

  await check("syncTurn appends the V-Run turn to the project", async () => {
    await link.syncTurn(fake.url, "ft_test", "p1", "add dark mode now", "Added a theme toggle.");
    const m = fake.projects.get("p1")!.messages.slice(-2);
    return m[0].content === "add dark mode now" && m[1].role === "assistant" && m[1].provider === "v-run";
  });

  await check("V.md memory: the agent can't save change logs; real facts and user notes still save", async () => {
    const mem = await import("../src/main/memory");
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-mem-"));
    ws.setRoot(proj);
    const logs = ["CSS margin-bottom missing colon syntax errors fixed in 8 HTML files (index, about).", "Fixed the navbar overlap", "Added dark mode toggle to header", "All margin-bottom properties were corrected",
      "The shop page redesign includes animated category filters, responsive product cards with hover zoom, Quick View modal functionality, sticky filter bar with glass morphism, and smooth filtering animations while preserving all existing functionality"];
    const facts = ["Start the site with npm start (port 3000)", "After editing CSS, check every property has a colon", "Fix bugs with a failing test first", "User prefers Tailwind over plain CSS"];
    let rejected = 0;
    for (const l of logs) { try { await mem.remember(l, "project", { fromAgent: true }); } catch (e) { if (/change log/.test((e as Error).message)) rejected++; } }
    for (const f of facts) await mem.remember(f, "project", { fromAgent: true });
    const userNote = await mem.remember("Fixed width layouts only on this project", "project"); // typed by the user: always saved
    const doc = fs.readFileSync(path.join(proj, "V.md"), "utf8");
    return rejected === logs.length && facts.every((f) => doc.includes(`- ${f}`)) && userNote.added && !doc.includes("navbar");
  });

  await check("V.md memory: project + personal files, dedup, Memory section, CRLF kept, in the system prompt", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-home-"));
    process.env.VRUN_HOME = home;
    const mem = await import("../src/main/memory");
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-mem-"));
    fs.writeFileSync(path.join(proj, "V.md"), "# Notes\r\n\r\n## Commands\r\n- npm test\r\n");
    ws.setRoot(proj);
    const a = await mem.remember("Use pnpm, never npm", "project");
    const dup = await mem.remember("- use pnpm, never npm", "project");
    await mem.remember("I like short answers", "user");
    const doc = fs.readFileSync(path.join(proj, "V.md"), "utf8");
    const status = await mem.memoryStatus();
    const prompt = await ai.systemPrompt("agent");
    const s = ai.getSession("mem");
    const events: any[] = [];
    const t = await ai.execTool(s, "remember", { fact: "Tests live in test/" }, (e) => events.push(e), "m1");
    delete process.env.VRUN_HOME;
    return a.added && !dup.added && doc.includes("\r\n## Memory\r\n- Use pnpm, never npm") && doc.includes("## Commands\r\n- npm test")
      && fs.readFileSync(path.join(home, "V.md"), "utf8").includes("- I like short answers")
      && status.project.entries === 2 && status.user.entries === 1
      && prompt.includes("Use pnpm, never npm") && prompt.includes("I like short answers")
      && t.summary === "Saved to V.md" && events.some((e) => e.type === "memory" && e.added)
      && ai.READ_ONLY.has("remember");
  });

  await check("autoConnect: sends the local sign-in token from .data and keeps only an ft_ token", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-auto-"));
    const none = await link.autoConnect("http://localhost:1", root); // no token file yet
    fs.mkdirSync(path.join(root, ".data"));
    fs.writeFileSync(path.join(root, ".data", "local-login.token"), "  secret-token-1234567890-abcdefghijklmn\n");
    let sent: any = null;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return Response.json({ token: "ft_good" });
    }) as unknown as typeof fetch;
    const ok = await link.autoConnect("http://localhost:3000", root, fake);
    const bad = await link.autoConnect("http://localhost:3000", root, (async () => Response.json({ token: "nope" })) as unknown as typeof fetch);
    return none === null && ok === "ft_good" && bad === null
      && sent.url === "http://localhost:3000/api/local/v-run-token" && sent.body.token === "secret-token-1234567890-abcdefghijklmn";
  });

  await check("Stop ends a command at once, even when a child process holds its output open", async () => {
    ws.setRoot(tmp);
    const s = ai.getSession("stop-cmd");
    s.abort = new AbortController();
    // approve automatically; the command starts a grandchild that keeps the pipes open forever
    const cmd = `node -e "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); setInterval(()=>{},1000)"`;
    const t0 = Date.now();
    const run = ai.execTool(s, "run_terminal_command", { command: cmd }, (e) => { if (e.type === "approval") ai.approve("stop-cmd", e.id, true); }, "c1");
    setTimeout(() => s.abort!.abort(), 1500);
    const r = await run;
    return Date.now() - t0 < 6000 && r.content.includes("[stopped by the user]");
  });

  await check("a server command asked of the terminal is started as the app instead", async () => {
    ws.setRoot(tmp);
    fs.writeFileSync(path.join(tmp, "server.js"), "require('http').createServer((q,r)=>r.end('ok')).listen(0,()=>console.log('listening'));");
    const s = ai.getSession("srv");
    s.abort = new AbortController();
    const r = await ai.execTool(s, "run_terminal_command", { command: "node server.js" }, (e) => { if (e.type === "approval") ai.approve("srv", e.id, true); }, "c2");
    const running = runner.appStatus().running;
    runner.stopApp();
    return r.content.startsWith("That command keeps running") && running
      && runner.LONG_RUNNING.test("python -m http.server 4321") && runner.LONG_RUNNING.test("npm run dev") && !runner.LONG_RUNNING.test("npm run build") && !runner.LONG_RUNNING.test("npx vite build");
  });

  await check("skills: GitHub links and SKILL.md frontmatter parse", async () => {
    const sk = await import("../src/main/skills");
    const a = sk.parseRepo("anthropics/skills");
    const b = sk.parseRepo("https://github.com/anthropics/skills/tree/main/document-skills/pdf");
    const c = sk.parseRepo("github.com/o/r@v2");
    const fm = sk.parseFrontmatter("---\nname: pdf\ndescription: >\n  Work with PDFs:\n  fill forms\nlicense: MIT\n---\n# Body\n");
    return a?.owner === "anthropics" && a.repo === "skills" && !a.ref && a.sub === ""
      && b?.ref === "main" && b.sub === "document-skills/pdf" && c?.ref === "v2" && sk.parseRepo("not a repo") === null
      && fm.meta.name === "pdf" && fm.meta.description === "Work with PDFs: fill forms" && fm.body.startsWith("# Body");
  });

  await check("skills: install from GitHub (each SKILL.md folder), skip big files, learn from a README otherwise", async () => {
    const sk = await import("../src/main/skills");
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-skills-"));
    const files: Record<string, string> = {
      "skills/pdf/SKILL.md": "---\nname: pdf\ndescription: Fill PDF forms\n---\nUse pypdf.",
      "skills/pdf/reference.md": "# API",
      "skills/pdf/big.bin": "x",
      "skills/slides/SKILL.md": "---\nname: Slides Maker\ndescription: Make decks\n---\nSteps.",
      "README.md": "# Repo",
    };
    const sizes: Record<string, number> = { "skills/pdf/big.bin": 5_000_000 };
    const fake = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/repos/o/withskills")) return Response.json({ default_branch: "main" });
      if (u.includes("/repos/o/withskills/git/trees/")) return Response.json({ tree: Object.keys(files).map((p) => ({ path: p, type: "blob", size: sizes[p] ?? files[p].length })) });
      if (u.endsWith("/repos/o/plain")) return Response.json({ default_branch: "main" });
      if (u.includes("/repos/o/plain/git/trees/")) return Response.json({ tree: [{ path: "README.md", type: "blob", size: 20 }, { path: "src/x.ts", type: "blob", size: 5 }] });
      const raw = u.match(/raw\.githubusercontent\.com\/o\/(\w+)\/main\/(.+)$/);
      if (raw) return new Response(raw[1] === "plain" ? "# Plain tool\nRun plain --go" : files[decodeURIComponent(raw[2])] ?? "", { status: 200 });
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const r = await sk.installFromGitHub("github.com/o/withskills", fake, dest);
    const plain = await sk.installFromGitHub("o/plain", fake, dest);
    const names = r.installed.map((x) => x.name).sort().join(",");
    const pdf = r.installed.find((x) => x.name === "pdf")!;
    return names === "pdf,slides-maker" && pdf.skipped === 1
      && fs.readFileSync(path.join(dest, "pdf", "reference.md"), "utf8") === "# API" && !fs.existsSync(path.join(dest, "pdf", "big.bin"))
      && JSON.parse(fs.readFileSync(path.join(dest, "pdf", ".vrun-source.json"), "utf8")).source.includes("github.com/o/withskills")
      && plain.installed.length === 0 && plain.readme.includes("Run plain --go");
  });

  await check("skills: learn one, list it in the prompt, load it and its files, built-in html-video, no path escapes", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-home-"));
    process.env.VRUN_HOME = home;
    const sk = await import("../src/main/skills");
    ws.setRoot(fs.mkdtempSync(path.join(os.tmpdir(), "vrun-proj-")));
    const s = ai.getSession("skills");
    const events: any[] = [];
    const saved = await ai.execTool(s, "save_skill", { name: "Deploy to Fly", description: "Use when deploying this kind of app to Fly.io", instructions: "1. fly launch\n2. fly deploy\nAlways set the region to ams." }, (e) => events.push(e), "k1");
    fs.writeFileSync(path.join(home, "skills", "deploy-to-fly", "notes.md"), "extra notes");
    const prompt = await ai.systemPrompt("agent", "deploy it");
    const used = await ai.execTool(s, "use_skill", { name: "deploy-to-fly" }, () => {}, "k2");
    const file = await ai.execTool(s, "use_skill", { name: "deploy-to-fly", file: "notes.md" }, () => {}, "k3");
    const video = await sk.loadSkill("html-video");
    let escaped = false;
    try { await sk.loadSkill("deploy-to-fly", "../../V.md"); escaped = true; } catch { /* refused */ }
    delete process.env.VRUN_HOME;
    return saved.summary === "Learned skill: deploy-to-fly" && events.some((e) => e.type === "skill")
      && prompt.includes("# Skills") && prompt.includes("- deploy-to-fly: Use when deploying") && prompt.includes("- html-video:")
      && used.content.includes("Always set the region to ams.") && used.content.includes("- notes.md")
      && file.content === "extra notes" && video.text.includes("window.__video") && !escaped;
  });

  await check("websites get a design direction per project; video tasks get the html-video skill instead", async () => {
    const seen = new Set<string>();
    let last = "";
    for (let i = 0; i < 12; i++) {
      ws.setRoot(fs.mkdtempSync(path.join(os.tmpdir(), `vrun-site${i}-`)));
      const p = await ai.systemPrompt("agent", "build me a landing page for my bakery");
      last = p.match(/Design direction for this project: ([^\n]+)/)?.[1] ?? "";
      seen.add(last);
    }
    const again = await ai.systemPrompt("agent", "make the hero bigger on the page");
    const vid = await ai.systemPrompt("agent", "make a 15 second animated intro video for my bakery website");
    console.log(`      ${seen.size} different directions across 12 projects`);
    return seen.size >= 4 && !seen.has("") && again.includes(`Design direction for this project: ${last}`)
      && again.includes("Avoid the generic AI look")
      && vid.includes('use_skill with name "html-video"') && !vid.includes("Building websites and UIs");
  });

  await check("chats are saved and restored: the transcript, and the agent's memory (images dropped)", async () => {
    const chats = await import("../src/main/chats");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-chats-"));
    chats.setChatsDir(dir);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-proj-"));
    chats.saveUi(root, { sid: "chat-1", mode: "agent", items: [{ kind: "user", text: "the cloudflare link" }] });
    chats.saveAgent("chat-1", { claude: [{ role: "user", content: [{ type: "image", source: {} }, { type: "text", text: "see this" }] }], ft: [{ role: "user", content: "the cloudflare link" }], skills: ["frontend-ui"] });
    const ui = chats.loadUi(root.toUpperCase()); // same project, path case doesn't matter on Windows
    const mem = chats.loadAgent("chat-1");
    const restored = ai.restoreSession("restored-1", mem?.claude, mem?.skills);
    const again = ai.restoreSession("restored-1", [{ role: "user", content: "other" }], []); // never overwrites a live session
    chats.setChatsDir(null);
    const s = ai.getSession("restored-1");
    return (ui?.items as any[])[0].text === "the cloudflare link" && restored && !again && s.skills.has("frontend-ui")
      && JSON.stringify(s.messages).includes("an image was attached here") && !JSON.stringify(s.messages).includes('"image"')
      && (mem?.ft as any[])[0].content === "the cloudflare link";
  });

  await check("restarting the app waits for the old one, so the new one gets its port; a busy port is reported", async () => {
    ws.setRoot(tmp);
    const port = 41000 + Math.floor(Math.random() * 2000);
    const serve = `node -e "require('http').createServer((q, s) => s.end('v' + process.argv[1])).listen(${port}, () => console.log('listening on http://localhost:${port}'))"`;
    await runner.startApp(`${serve} 1`);
    await runner.settle(8000);
    await runner.startApp(`${serve} 2`); // a restart: same port
    await runner.settle(8000);
    const body = await fetch(`http://localhost:${port}`).then((r) => r.text()).catch((e) => String(e));
    await runner.stopAppAndWait();
    return body === "v2" && runner.portInUse("Error: listen EADDRINUSE: address already in use :::3000") === 3000
      && runner.portInUse("Port 5173 is already in use") === 5173 && runner.portInUse("all good") === null || body;
  });

  await check("in a web project, 'redesign the app / fix the images' gets the design brief (and not elsewhere)", async () => {
    const site = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-site-"));
    fs.mkdirSync(path.join(site, "public"));
    fs.writeFileSync(path.join(site, "public", "index.html"), "<!doctype html><title>Shop</title>");
    const py = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-py-"));
    fs.writeFileSync(path.join(py, "main.py"), "print('hi')\n");
    const ask = "redesign the entire app, it feels AI-built, make it very nice and the images aren't added properly";
    ws.setRoot(site);
    const inSite = await ai.systemPrompt("agent", ask);
    ws.setRoot(py);
    const inPy = await ai.systemPrompt("agent", ask);
    return inSite.includes("Building websites and UIs") && !inPy.includes("Building websites and UIs");
  });

  await check("the web design brief is added for website tasks only", async () => {
    const web = await ai.systemPrompt("agent", "build me a landing page for my bakery");
    const other = await ai.systemPrompt("agent", "fix the off-by-one bug in parser.py");
    const ask = await ai.systemPrompt("ask", "build me a landing page");
    process.env.VRUN_DESIGN_BRIEF = "off";
    const off = await ai.systemPrompt("agent", "build me a landing page");
    delete process.env.VRUN_DESIGN_BRIEF;
    const bar = "Building websites and UIs";
    return web.includes(bar) && !other.includes(bar) && !ask.includes(bar) && !off.includes(bar);
  });

  await check("rate limits are waited out (Retry-After honoured, backoff capped, gives up after 6)", () => {
    const w = ftAi.rateLimitWait;
    return w({ status: 429, headers: new Headers({ "retry-after": "3" }) }, 0) === 3000
      && w({ status: 429, headers: {} }, 2) === 16000 && w({ status: 429 }, 5) === 30000
      && w({ status: 429 }, 6) === null && w({ status: 502 }, 0) === 2000 && w({ status: 502 }, 2) === null && w({ status: 400 }, 0) === null && w(new Error("x"), 0) === null;
  });

  await check("runner finds a server address printed without http:// (\"started on 0.0.0.0:8501\")", async () => {
    ws.setRoot(tmp);
    const urls: string[] = [];
    runner.onRunEvent((e) => e.type === "url" && urls.push(e.url));
    await runner.startApp(`node -e "console.log('connecting to db at localhost:5432'); console.log('Server started on 0.0.0.0:8501'); setTimeout(() => {}, 4000)"`);
    await runner.settle(6000);
    runner.stopApp();
    return urls[0] === "http://localhost:8501";
  });

  await check("app_output: quiet app gets advice, then polling is refused after 3 empty polls", async () => {
    await runner.startApp(`node -e "console.log('hi'); setTimeout(() => {}, 30000)"`);
    for (let i = 0; i < 100 && !runner.appStatus().output.includes("hi"); i++) await new Promise((r) => setTimeout(r, 100));
    const s = ai.getSession("poll");
    const out = await ai.execTool(s, "app_output", {}, () => {}, "a1"); // has "hi"
    const q1 = await ai.execTool(s, "app_output", { wait_seconds: 0.2 }, () => {}, "a2");
    const q2 = await ai.execTool(s, "app_output", { wait_seconds: 0.2 }, () => {}, "a3");
    const q3 = await ai.execTool(s, "app_output", { wait_seconds: 0.2 }, () => {}, "a4").then(() => "no error", (e: Error) => e.message);
    runner.stopApp();
    return out.content.includes("hi") && q1.summary === "No new output" && q2.content.includes("Polling again won't change that")
      && q3.startsWith("Not polling again");
  });

  fake.close();
  console.log(failures ? `\n${failures} failed` : "\nall V-Run ⇄ FreeToken checks passed");
  process.exit(failures ? 1 : 0);
}
main();
