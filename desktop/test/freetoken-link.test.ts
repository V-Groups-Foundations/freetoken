// V-Run ⇄ FreeToken: deep links, continuing a project (folder, transcript, seeded agent), writing turns
// back, plus the runner/agent fixes for quiet servers. Uses the fake FreeToken server; no Electron.
import fs from "node:fs";
import http from "node:http";
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

  await check("web tools: search results are parsed; APIs are read directly, pages through the reader", async () => {
    const web = await import("../src/main/web");
    const ddg = `<table><tr><td><a rel="nofollow" href="https://skyscraperpage.com/b130572" class='result-link'>Sumitomo Fudosan Akihabara Building &amp; more</a></td></tr>
      <tr><td class='result-snippet'>19 floors, <b>completed</b> 2009</td></tr></table>`;
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("duckduckgo")) return new Response(ddg, { headers: { "content-type": "text/html" } });
      if (String(url).includes("nominatim")) return Response.json([{ lat: "35.7", lon: "139.77", display_name: "Sumitomo Fudosan Akihabara Building" }]);
      if (String(url).startsWith("https://r.jina.ai/")) return Response.json({ data: { title: "Leasing page", content: "# Typical floor\n1,069 m²" } });
      return new Response("<html><title>x</title><body>page</body></html>", { headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const hits = await web.webSearch("sumitomo akihabara", 5, fake);
    const api = await web.fetchUrl("https://nominatim.openstreetmap.org/search?format=json&q=akihabara", 0, fake);
    const page = await web.fetchUrl("office.sumitomo-rd.co.jp/building", 0, fake);
    return hits[0]?.url === "https://skyscraperpage.com/b130572" && hits[0].title.includes("& more") && hits[0].snippet === "19 floors, completed 2009"
      && api.via === "direct" && api.text.includes("139.77") && page.via === "reader" && page.text.includes("1,069 m²") && page.url.startsWith("https://")
      && ai.READ_ONLY.has("web_search") && ai.toolNamesFor({ mode: "ask" }).has("fetch_url") || JSON.stringify({ hits, api: api.via, page: page.via });
  });

  await check("code pasted instead of building: sent back once to write the files (not for questions or once files changed)", async () => {
    const s = ai.getSession("nudge");
    s.mode = "agent"; s.codeNudges = 0; s.turns = [{ provider: "ft", hist: 0, files: new Map() }];
    const dump = "Here's the code:\n```html\n" + Array.from({ length: 20 }, (_, i) => `<p>${i}</p>`).join("\n") + "\n```\nCopy this into your index.html.";
    const first = ai.buildNudge(s, dump, "yes start building it");
    const second = ai.buildNudge(s, dump, "yes start building it");
    s.codeNudges = 0;
    const question = ai.buildNudge(s, dump, "what is a floor plan?");
    s.turns[0].files.set("index.html", null);
    const built = ai.buildNudge(s, dump, "build it");
    s.mode = "ask"; s.turns[0].files.clear();
    const ask = ai.buildNudge(s, dump, "build it");
    // a false claim of work is caught too
    s.mode = "agent"; s.codeNudges = 0; s.turns[0].files.clear();
    const lie = ai.buildNudge(s, "I've created a 3D model of the building.\n\n**Files Created:**\n- index.html", "can u build it");
    return !!first?.prompt.includes("write the files now") && second === null && question === null && built === null && ask === null
      && !!lie?.prompt.includes("Never claim work that didn't happen");
  });

  await check("solo agents review their own changes once; big jobs plan first and verify each step", async () => {
    const s = ai.getSession("review");
    ai.startTurnState(s, { sessionId: "review", mode: "agent", text: "build a 3D building tracker app with floors and share links" });
    s.turns = [{ provider: "ft", hist: 0, files: new Map([["index.html", null], ["app.js", null]]) }];
    const review = ai.buildNudge(s, "Done! It works.", "build it");
    const second = ai.buildNudge(s, "Done! It works.", "build it");
    // a small one-file tweak isn't reviewed
    ai.startTurnState(s, { sessionId: "review", mode: "agent", text: "make the title blue" });
    s.turns = [{ provider: "ft", hist: 0, files: new Map([["index.html", null]]) }];
    const small = ai.buildNudge(s, "Done.", "make the title blue");
    // workers don't (the team's reviewer does)
    ai.startTurnState(s, { sessionId: "review", mode: "agent", text: "build the api", worker: { name: "api", supervisor: "x" } });
    s.turns = [{ provider: "ft", hist: 0, files: new Map([["a.ts", null], ["b.ts", null]]) }];
    const worker = ai.buildNudge(s, "Done.", "build the api");
    // an empty last reply is asked once for the summary
    ai.startTurnState(s, { sessionId: "review", mode: "agent", text: "fix it" });
    s.turns = [{ provider: "ft", hist: 0, files: new Map() }];
    const silent = ai.buildNudge(s, "  ", "fix it")?.kind === "summary" && ai.buildNudge(s, "  ", "fix it") === null;
    const big = ai.isBigJob("build a location tracker app for my building") && !ai.isBigJob("make the title blue") && !ai.isBigJob("why does this crash?");
    return (review?.kind === "review" && review.prompt.includes("index.html, app.js") && second === null && small === null && worker === null && big && silent)
      || JSON.stringify({ review: review?.kind, second, small, worker, big });
  });

  await check("\"build it\" after describing an app is a big job; near the step limit the agent is told to wrap up", async () => {
    const s = ai.getSession("followup");
    ai.startTurnState(s, { sessionId: "followup", mode: "agent", text: "now can u build it" }, "i want a location tracker app with a 3D model of my building");
    const follow = s.bigJob;
    ai.startTurnState(s, { sessionId: "followup", mode: "agent", text: "what does this error mean?" }, "i want a location tracker app with a 3D model of my building");
    return (follow === true && s.bigJob === false && ai.stepsLeftNote(ai.MAX_STEPS - 9)?.includes("honest summary") && ai.stepsLeftNote(10) === null) || JSON.stringify({ follow, now: s.bigJob });
  });

  await check("going in circles is caught: repeats, ping-pong between servers, new ports; the third time it must stop", async () => {
    const s = ai.getSession("loops");
    ai.startTurnState(s, { sessionId: "loops", mode: "agent", text: "fix the page" });
    const act = (name: string, input: object, out = "ok", changed = false) => ai.noteAction(s, name, input, out, changed);
    // the same inspect three times with nothing changed in between
    const a = [act("inspect_preview", {}), act("inspect_preview", {}), act("inspect_preview", {})];
    const first = a[2].includes("going in circles") && s.stuck === true && a[0] === "" && a[1] === "";
    // a file change in between is progress
    s.stuck = false;
    act("inspect_preview", {}); act("edit_file", { path: "a.js" }, "Edited a.js", true); act("inspect_preview", {});
    const progress = !s.stuck;
    // frontend/backend ping-pong on changing ports
    const pp = [
      act("run_app", { command: "npx serve . -l 5173" }), act("run_app", { command: "node server.js" }), act("run_app", { command: "npx serve . -l 5174" }),
    ];
    const pingPong = pp[2].includes("going in circles") || pp.some((x) => x.includes("going in circles")) || (act("run_app", { command: "node server.js" }) + act("run_app", { command: "npx serve . -l 5175" }) + act("run_app", { command: "node server.js" })).includes("going in circles");
    // third warning: stop, and changing or running anything is refused
    act("app_output", {}); act("app_output", {}); const third = act("app_output", {});
    const refused = await ai.execTool(s, "run_app", { command: "npm start" }, () => {}, "x");
    const readOk = !(await ai.execTool(s, "list_dir", { path: "." }, () => {}, "y").catch((e) => ({ summary: String(e) }))).summary.startsWith("Stopped");
    const sameMove = ai.actionSig("run_app", { command: "npx serve . -l 5173" }) === ai.actionSig("run_app", { command: "npx serve . -l 8080" });
    // not loops: a supervisor waiting on its agents; the same probe getting a different answer each time
    const s2 = ai.getSession("loops-2");
    ai.startTurnState(s2, { sessionId: "loops-2", mode: "team", text: "build it" });
    const waits = [1, 2, 3, 4, 5, 6].map(() => ai.noteAction(s2, "wait_for_agents", {}, "Agents still working", false));
    const probes = ["a", "b", "c", "d"].map((x) => ai.noteAction(s2, "inspect_preview", { script: "app.state" }, `state ${x}`, false));
    if (waits.some(Boolean) || probes.some(Boolean) || s2.stuck) return JSON.stringify({ waits, probes });
    return (first && progress && pingPong && third.includes("STOP") && s.mustStop === true && refused.summary.includes("going in circles") && readOk && sameMove)
      || JSON.stringify({ first, progress, pingPong, third, refused: refused.summary, readOk, sameMove });
  });

  await check("saved checks: stored in the project, rerun against the page; a broken feature sends the agent back", async () => {
    const checks = await import("../src/main/checks");
    ws.setRoot(tmp);
    const g = globalThis as any;
    g.Element ??= class {};
    g.__app = { dialogOpen: false, link: "" };
    // a preview whose "page" is __app: actions and expectations run through the real probe wrapper
    const opened: string[] = [];
    runner.setPreviewHost({
      async open(u) { opened.push(u); g.__app = { dialogOpen: false, link: g.__broken ? "" : "pending" }; },
      async inspect() { return { url: "http://localhost:5173/", title: "t", text: "", console: [] }; },
      evaluate: (script) => (0, eval)(runner.probeScript(script)),
    });
    try {
      const file = await checks.saveCheck({ name: "Share dialog", steps: [
        { action: "__app.dialogOpen = true; __app.link = __app.link && 'https://x.test/s/1'", expect: "__app.dialogOpen && __app.link.startsWith('https')", wait_ms: 10 },
      ] });
      const { checks: saved } = await checks.loadChecks();
      const pass = await checks.runChecks(runner.previewHost(), saved, "http://localhost:5173/");
      // the regression gate: files changed this task → saved checks rerun before "done"
      const s = ai.getSession("gate");
      ai.startTurnState(s, { sessionId: "gate", mode: "agent", text: "tweak the header" });
      s.turns = [{ provider: "ft", hist: 0, files: new Map([["index.html", null]]) }];
      s.filesSinceGate = true;
      const events: any[] = [];
      const okGate = await ai.regressionGate(s, (e) => events.push(e));
      g.__broken = true; s.filesSinceGate = true;
      const badGate = await ai.regressionGate(s, (e) => events.push(e));
      const noNewChanges = await ai.regressionGate(s, () => {}); // nothing changed since: not rerun
      return (file === ".v-run/checks/share-dialog.json" && saved.length === 1 && pass[0].ok && okGate === null
        && !!badGate?.includes("✗ Share dialog") && badGate.includes("expected") && noNewChanges === null
        && events.filter((e) => e.type === "tool_end").map((e) => e.ok).join() === "true,false" && checks.truthy("{\"a\":1}") && !checks.truthy("false") && !checks.truthy("Error: x"))
        || JSON.stringify({ file, pass, okGate, badGate, events: events.map((e) => e.summary) });
    } finally { runner.setPreviewHost(null); delete g.__broken; }
  });

  await check("thinking goes to a reasoning model: planning a big job, Plan mode, and getting unstuck", async () => {
    const r = ftAi.stepRole;
    return r({ stuck: true }, { mode: "agent" }, 9) === "reasoning" && r({}, { mode: "plan" }, 3) === "reasoning"
      && r({ bigJob: true, planned: false }, { mode: "agent" }, 0) === "reasoning" && r({ bigJob: true, planned: false }, { mode: "agent" }, 1) === undefined
      && r({ bigJob: true, planned: true }, { mode: "agent" }, 0) === undefined && r({}, { mode: "agent" }, 0) === undefined;
  });

  await check("a frontend and its backend run together; the same command again restarts only that one", async () => {
    ws.setRoot(tmp);
    const server = (name: string) => `node -e "const s=require('http').createServer((q,r)=>r.end('${name}'));s.listen(0,()=>console.log('${name} at http://localhost:'+s.address().port))"`;
    const urlOf = () => runner.appStatus().url!;
    const get = (u: string) => fetch(u).then((r) => r.text(), () => "down");
    await runner.startApp(server("front")); await runner.settle(8000);
    const front = urlOf();
    await runner.startApp(server("back")); await runner.settle(8000);
    const back = urlOf();
    const both = [await get(front), await get(back)];
    const listed = runner.describe().includes("Also running") && runner.otherApps().length === 1;
    await runner.startApp(server("front")); await runner.settle(8000); // same command: the old frontend is replaced
    const oldFrontGone = (await get(front)) === "down", backStill = (await get(back)) === "back";
    runner.stopApp();
    await new Promise((r) => setTimeout(r, 1500));
    const allDown = (await get(back)) === "down" && (await get(urlOf())) === "down";
    return (both.join() === "front,back" && listed && oldFrontGone && backStill && allDown && runner.commandPort("npx serve . -l 5173") === 5173 && runner.commandPort("PORT=3001 node server.js") === 3001)
      || JSON.stringify({ both, listed, oldFrontGone, backStill, allDown });
  });

  await check("agents can't take over or stop FreeToken's port (serve on it, kill it, kill all node)", async () => {
    runner.setProtectedPorts(() => [{ port: 3000, name: "FreeToken" }]);
    try {
      const refused = await Promise.all([
        "npx serve . -p 3000", "npx http-server -p 3000", "python -m http.server 3000", "npx kill-port 3000",
        "taskkill /F /IM node.exe", "Stop-Process -Name node -Force", "Get-NetTCPConnection -LocalPort 3000 | % { Stop-Process -Id $_.OwningProcess }",
      ].map((c) => runner.guardCommand(c)));
      const allowed = await Promise.all(["npx serve . -p 5173", "npm run dev -- --port 5173", "node server.js", "npm test", "echo 30000"].map((c) => runner.guardCommand(c)));
      const out = ftAi.describeFreeTokenError(new (await import("openai")).default.NotFoundError(404, { message: "The requested path could not be found" }, "404 The requested path could not be found", new Headers()));
      return (refused.every((r) => r?.includes("FreeToken")) && allowed.every((r) => r === null) && out.includes("Something other than FreeToken"))
        || JSON.stringify({ refused, allowed, out });
    } finally { runner.setProtectedPorts(() => []); }
  });

  await check("the page probe returns readable values, even for cyclic objects, and reports errors", async () => {
    const g = globalThis as any;
    g.Element ??= class {};
    const cyclic: any = { name: "scene", children: [{ type: "Mesh", position: { x: 0, y: 3, z: 0 } }] };
    cyclic.children[0].parent = cyclic;
    g.__probe = cyclic;
    const ok = JSON.parse(await (0, eval)(runner.probeScript("__probe")));
    const err = await (0, eval)(runner.probeScript("notDefinedAnywhere.x"));
    const num = await (0, eval)(runner.probeScript("await Promise.resolve(6 * 7)"));
    return (ok.children[0].position.y === 3 && ok.children[0].parent === "[circular]" && /^Error: .*notDefinedAnywhere/.test(err) && num === "42") || JSON.stringify({ ok, err, num });
  });

  await check("FreeToken hears how each model did (bad tool calls, verified finished work)", async () => {
    const seen: any[] = [];
    const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.end("{}"); }); });
    await new Promise<void>((r) => srv.listen(0, r));
    ftAi.configureFreeToken({ url: () => `http://127.0.0.1:${(srv.address() as any).port}/api/v1`, token: () => "ft_test" });
    ftAi.reportModel("groq/qwen/qwen3.8-27b", false, "invalid tool call");
    ftAi.reportModel(null, true, "nothing to report");
    for (let i = 0; i < 50 && !seen.length; i++) await new Promise((r) => setTimeout(r, 20));
    srv.close();
    ftAi.configureFreeToken({ url: () => fake.url });
    const f = seen[0];
    return (seen.length === 1 && f.url === "/api/v1/feedback" && f.auth === "Bearer ft_test" && f.body.model === "groq/qwen/qwen3.8-27b" && f.body.good === false && f.body.task === "agent") || JSON.stringify(seen);
  });

  await check("long-running tasks: no small step limit; a long transcript is saved (big old outputs trimmed) and comes back", async () => {
    const chats = await import("../src/main/chats");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-long-"));
    chats.setChatsDir(dir);
    // 300 steps with 50k-character tool outputs: ~15 MB raw
    const ft: any[] = [{ role: "user", content: "build the tracker" }];
    for (let i = 0; i < 300; i++) ft.push({ role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_file", arguments: "{}" } }] }, { role: "tool", tool_call_id: `c${i}`, content: `out ${i} ` + "y".repeat(50_000) });
    await chats.saveAgent("long-1", { ft, skills: [] });
    const back = chats.loadAgent("long-1")?.ft as any[] | undefined;
    const old = back?.[2]?.content as string, recent = back?.at(-1)?.content as string;
    chats.markRunning("long-1", { text: "build the tracker", mode: "agent", startedAt: 1 });
    const running = chats.loadRunning("long-1")?.text;
    chats.markRunning("long-1", null);
    chats.setChatsDir(null);
    return (ai.MAX_STEPS >= 1000 && back?.length === ft.length && old.includes("characters cut when saved") && old.startsWith("out 0") && recent.length > 50_000
      && running === "build the tracker" && chats.loadRunning("long-1") === null)
      || JSON.stringify({ max: ai.MAX_STEPS, len: back?.length, old: old?.slice(0, 40), recent: recent?.length, running });
  });

  await check("chats are saved and restored: the transcript, and the agent's memory (images dropped)", async () => {
    const chats = await import("../src/main/chats");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-chats-"));
    chats.setChatsDir(dir);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-proj-"));
    chats.saveUi(root, { sid: "chat-1", mode: "agent", items: [{ kind: "user", text: "the cloudflare link" }] });
    await chats.saveAgent("chat-1", { claude: [{ role: "user", content: [{ type: "image", source: {} }, { type: "text", text: "see this" }] }], ft: [{ role: "user", content: "the cloudflare link" }], skills: ["frontend-ui"] });
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
      && w({ status: 429 }, 6) === null && w({ status: 502 }, 0) === 2000 && w({ status: 502 }, 2) === null && w({ status: 400 }, 0) === null && w(new Error("x"), 0) === null
      // a stream dropped mid-answer is asked again (twice), not the end of the task
      && w(new Error("FreeToken error : Upstream idle timeout exceeded"), 0) === 1500 && w(new Error("socket hang up"), 1) === 3000
      && w(new Error("Upstream idle timeout exceeded"), 2) === 4500 && w(new Error("Upstream idle timeout exceeded"), 3) === null && ftAi.brokeOff(new Error("socket hang up")) && !ftAi.brokeOff({ status: 400, message: "timed out" });
  });

  await check("a server listening on all interfaces ([::] / 0.0.0.0) opens as localhost", async () => {
    ws.setRoot(tmp);
    const urls: string[] = [];
    runner.onRunEvent((e) => e.type === "url" && urls.push(e.url));
    await runner.startApp(`node -e "console.log('Serving HTTP on :: port 8080 (http://[::]:8080/) ...'); setTimeout(() => {}, 3000)"`);
    await runner.settle(5000);
    await runner.stopAppAndWait();
    return urls.includes("http://localhost:8080/") || JSON.stringify(urls);
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
