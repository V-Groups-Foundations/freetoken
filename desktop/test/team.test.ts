// Team mode: a supervisor runs two worker agents in parallel through the real FreeToken agent loop
// against a scripted OpenAI-compatible server, and the file coordinator keeps them apart.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { teamScript } from "./fake-openai";
let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}${typeof r === "string" ? `: ${r}` : ""}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}: ${(e as Error).stack}`); }
}

const seen: any[] = [];
function startServer(): Promise<{ url: string; close: () => void }> {
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      if (!req.url?.includes("/chat/completions")) { res.writeHead(404).end(); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      const blocks = teamScript(body) ?? [{ type: "text" as const, text: "ok" }];
      await new Promise((r) => setTimeout(r, 30)); // let the agents interleave
      const id = `c${++n}`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: "fake", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: "assistant" });
      let index = 0;
      for (const b of blocks) {
        if (b.type === "text") send({ content: b.text });
        else { send({ tool_calls: [{ index, id: `call_${n}_${index}`, type: "function", function: { name: b.name, arguments: JSON.stringify(b.args) } }] }); index++; }
      }
      send({}, index ? "tool_calls" : "stop");
      res.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, close: () => server.close() })));
}

(async () => {
  const ws = await import("../src/main/workspace");
  const ai = await import("../src/main/ai");
  const ft = await import("../src/main/ai-freetoken");
  const team = await import("../src/main/team");
  const fake = await startServer();
  ft.configureFreeToken({ url: () => fake.url, token: () => "ft_test", model: () => "auto-smart" });
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-team-"));
  fs.mkdirSync(path.join(proj, "src"));
  ws.setRoot(proj);

  // ---- the coordinator on its own
  await check("coordinator: owners, stale reads and change notices", async () => {
    team.resetTeams();
    const snaps: any[] = [];
    team.configureTeam({ run: () => new Promise(() => {}), stop: () => {}, getSession: ai.getSession, forward: () => {}, onTeam: (_s, x) => snaps.push(x) });
    team.spawn("S", { name: "a", task: "task for a, long enough", files: ["x.ts"] }, (p) => p);
    team.spawn("S", { name: "b", task: "task for b, long enough" }, (p) => p);
    const A = team.workerSid("S", "a"), B = team.workerSid("S", "b");
    const blockedB = team.guardWrite(B, "x.ts", true);
    team.noteRead(B, "y.ts");
    team.noteWrite(A, "y.ts", "Edited y.ts");
    const notice = team.takeNotices(B);
    const ownedByA = team.guardWrite(B, "y.ts", true); // a changed it, so a owns it now
    team.assign("S", "y.ts", "b");
    team.takeNotices(B);
    const staleB = team.guardWrite(B, "y.ts", true); // b's, but b hasn't seen a's change
    team.noteRead(B, "y.ts");
    const freshB = team.guardWrite(B, "y.ts", true);
    const blockedSup = team.guardWrite("S", "x.ts", true);
    team.assign("S", "x.ts", "b");
    const afterAssign = team.guardWrite(B, "x.ts", false);
    const solo = team.guardWrite("someone-else", "x.ts", true);
    return (blockedB?.startsWith("🔒") ?? false) && notice.includes('agent "a" changed y.ts') && (ownedByA?.startsWith("🔒") ?? false) && (staleB?.startsWith("⚠") ?? false)
      && freshB === null && (blockedSup?.includes("assign_file") ?? false) && afterAssign === null && solo === null
      && snaps.at(-1).agents.find((x: any) => x.name === "b").files.includes("x.ts") || JSON.stringify({ blockedB, notice, staleB, freshB, blockedSup, afterAssign });
  });

  await check("Team mode: the supervisor can't write or run anything until it has started agents", async () => {
    team.resetTeams();
    team.configureTeam({ run: () => new Promise(() => {}), stop: () => {}, getSession: ai.getSession, forward: () => {}, onTeam: () => {} });
    const s = ai.getSession("sup-guard");
    s.mode = "team";
    const write = () => ai.execTool(s, "write_file", { path: "src/solo.ts", contents: "x" }, () => {}, "w1");
    const before = await write();
    const blockedOnDisk = !fs.existsSync(path.join(proj, "src", "solo.ts"));
    const read = await ai.execTool(s, "list_dir", { path: "." }, () => {}, "r1");
    await ai.execTool(s, "spawn_agent", { name: "ui", task: "Build the UI part of the app.", files: ["src/ui.ts"] }, () => {}, "sp1");
    const after = await write();
    const agentMode = ai.getSession("solo-agent");
    agentMode.mode = "agent";
    const solo = await ai.execTool(agentMode, "write_file", { path: "src/solo2.ts", contents: "y" }, () => {}, "w2");
    return before.summary === "Team mode: start agents first" && blockedOnDisk && !read.summary.includes("start agents")
      && after.summary.startsWith("Created") && solo.summary.startsWith("Created") || JSON.stringify({ before: before.summary, after: after.summary, solo: solo.summary });
  });

  // ---- a whole team through the real agent loop
  team.resetTeams();
  const events = new Map<string, any[]>();
  const snapshots: any[] = [];
  team.configureTeam({
    run: (req, emit) => ft.chatFreeToken(req, emit),
    stop: (sid) => ai.stop(sid),
    getSession: ai.getSession,
    forward: (sid, e) => { (events.get(sid) ?? events.set(sid, []).get(sid)!).push(e); },
    onTeam: (_s, snap) => snapshots.push(snap),
  });
  const supEvents: any[] = [];
  const t0 = Date.now();
  await new Promise<void>((resolve) => ft.chatFreeToken({ sessionId: "sup", mode: "team", text: "Build the user page" }, (e) => { supEvents.push(e); if (e.type === "done") resolve(); }));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const final = supEvents.filter((e) => e.type === "text").map((e) => e.delta).join("");
  console.log(`      supervisor finished in ${secs}s: ${final.slice(0, 220)}`);

  await check("the supervisor starts two agents, which run at the same time", async () => {
    const running = snapshots.some((s) => s.agents.length === 2 && s.agents.every((a: any) => a.status === "running" || a.status === "waiting"));
    return running && supEvents.filter((e) => e.type === "tool_start" && e.name === "spawn_agent").length === 2;
  });
  await check("a worker can't edit a file another active agent owns", async () => final.includes("editing api.ts was BLOCKED") || final);
  await check("a worker's question reaches the supervisor, and the answer gets back", async () =>
    fs.readFileSync(path.join(proj, "src", "api.ts"), "utf8").startsWith("// async per supervisor") && supEvents.some((e) => e.type === "tool_end" && e.summary === "An agent has a question"));
  await check("both reports come back to the supervisor; both files exist", async () =>
    final.includes("api report") && final.includes("web report") && fs.existsSync(path.join(proj, "src", "web.ts")));
  await check("workers' events are tagged with their own session ids", async () =>
    (events.get(team.workerSid("sup", "api")) ?? []).some((e) => e.type === "tool_start" && e.name === "ask_supervisor")
    && (events.get(team.workerSid("sup", "web")) ?? []).some((e) => e.type === "done"));
  await check("the team's file changes land in the supervisor's review", async () => {
    const pending = ai.pendingChanges("sup").sort().join(",");
    return pending === "src/api.ts,src/web.ts" || pending;
  });
  await check("a reviewer checks the work automatically once the agents finish; it can't edit, and its verdict reaches the supervisor", async () => {
    const reqs = seen.filter((b) => String(b.messages?.[0]?.content).includes("You are the reviewer of a team"));
    const tools = new Set(reqs.flatMap((b) => (b.tools ?? []).map((t: any) => t.function.name)));
    const firstReview = seen.findIndex((b) => String(b.messages?.[0]?.content).includes("You are the reviewer of a team"));
    const lastBuilder = seen.map((b) => String(b.messages?.[0]?.content)).map((sys, i) => (/You are agent "(api|web)"/.test(sys) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const task = String(reqs[0]?.messages?.find((m: any) => m.role === "user")?.content ?? "");
    return reqs.length > 0 && firstReview > lastBuilder && tools.has("read_file") && tools.has("run_terminal_command") && !tools.has("write_file") && !tools.has("edit_file")
      && task.includes("src/api.ts") && task.includes("src/web.ts") && final.includes("APPROVED") && final.includes("reviewer")
      || JSON.stringify({ reqs: reqs.length, firstReview, lastBuilder, tools: [...tools], final: final.slice(-300) });
  });
  await check("the name 'reviewer' is reserved for the automatic reviewer", async () => {
    try { team.spawn("sup-x", { name: "reviewer", task: "do some reviewing please" }, (p) => p); return false; } catch (e) { return /reserved/.test((e as Error).message); }
  });

  await check("Agent mode has no team tools; workers only get ask_supervisor", async () => {
    const agent = ai.toolNamesFor({ mode: "agent" }), teamMode = ai.toolNamesFor({ mode: "team" }), worker = ai.toolNamesFor({ mode: "agent", worker: { name: "x", supervisor: "s" } });
    return !agent.has("spawn_agent") && !agent.has("ask_supervisor") && teamMode.has("spawn_agent") && teamMode.has("edit_file")
      && worker.has("ask_supervisor") && !worker.has("spawn_agent") && !ai.toolNamesFor({ mode: "ask" }).has("edit_file");
  });

  await check("a team survives a restart: agents, reports and file ownership come back; mid-task agents show as stopped", async () => {
    team.resetTeams();
    team.configureTeam({ run: () => new Promise(() => {}), stop: () => {}, getSession: ai.getSession, forward: () => {}, onTeam: () => {} });
    team.spawn("sup-r", { name: "web", task: "build the page", files: ["index.html"] }, (p) => p);
    const saved = JSON.parse(JSON.stringify(team.exportTeam("sup-r")));
    team.resetTeams(); // V-Run closed
    const before = team.hasAgents("sup-r");
    const ok = team.importTeam("sup-r", saved);
    const again = team.importTeam("sup-r", saved); // never over a live team
    const snap = team.snapshot("sup-r").agents[0];
    const blocked = team.guardWrite(team.workerSid("sup-r", "other"), "index.html", true);
    return (!before && ok && !again && team.hasAgents("sup-r") && snap.name === "web" && snap.status === "stopped" && snap.files.includes("index.html")
      && /message_agent/.test(snap.report) && blocked === null) || JSON.stringify({ before, ok, again, snap, blocked }); // a stopped owner doesn't block others
  });

  fake.close();
  console.log(failures ? `\n${failures} failed` : "\nall team checks passed");
  process.exit(failures ? 1 : 0);
})();
