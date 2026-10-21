// FreeToken provider: the full agent loop, Ctrl+K, Tab, model list and errors, against a fake
// OpenAI-compatible server. Set FREETOKEN_LIVE_URL + FREETOKEN_LIVE_TOKEN to also hit a real one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as AI from "../src/main/ai";
import { startFakeOpenAI } from "./fake-openai";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-ft-"));
  const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  w("src/hello.ts", "export function greet(name: string) {\n  return `Hello ${name}`;\n}\n");
  w("src/math.ts", "export function add(a, b) {\n  return a + b;\n}\n");
  const fake = await startFakeOpenAI("ft_test");
  const ws = await import("../src/main/workspace");
  const ft = await import("../src/main/ai-freetoken");
  ws.setRoot(dir);
  let token = "ft_test";
  ft.configureFreeToken({ url: () => fake.url, token: () => token, model: () => "auto-smart" });

  let failures = 0;
  async function check(name: string, fn: () => unknown | Promise<unknown>) {
    try { const r = await fn(); if (r === false) throw new Error("returned false"); console.log(`PASS  ${name}`); }
    catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
  }

  await check("model list comes from FreeToken /models", async () => (await ft.listModels()).join() === "auto-smart,auto-fast,groq/llama-3.3-70b");

  await check("agent loop over FreeToken: tools stream in, run locally, results go back", async () => {
    const events: AI.AgentEvent[] = [];
    await ft.chatFreeToken({ sessionId: "f1", mode: "agent", text: "Rename greet to sayHello" }, (e) => {
      events.push(e);
      if (e.type === "approval") setTimeout(async () => (await import("../src/main/ai")).approve("f1", e.id, true), 5);
    });
    const errs = events.filter((e) => e.type === "error");
    if (errs.length) throw new Error(JSON.stringify(errs));
    const ends = events.filter((e) => e.type === "tool_end") as Extract<AI.AgentEvent, { type: "tool_end" }>[];
    if (!ends.every((e) => e.ok)) throw new Error(JSON.stringify(ends.filter((e) => !e.ok)));
    const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("");
    return fs.readFileSync(path.join(dir, "src/hello.ts"), "utf8").includes("sayHello(") && fs.existsSync(path.join(dir, "NOTES.md"))
      && ends.some((e) => e.summary.includes("exit code 0")) && text.includes("via FreeToken");
  });

  await check("requests are OpenAI-format with tools, streaming, model auto-smart, ft_ bearer", () => {
    const r = fake.requests.find((x) => x.tools);
    const toolMsg = fake.requests.at(-1).messages.find((m: any) => m.role === "tool");
    return r.model === "auto-smart" && r.stream === true && r.tools.every((t: any) => t.type === "function" && t.function.parameters)
      && r.messages[0].role === "system" && !!toolMsg?.tool_call_id;
  });

  await check("agent edits are checkpointed for review (reject restores)", async () => {
    const ai = await import("../src/main/ai");
    const pending = ai.pendingChanges("f1").sort().join();
    await ai.rejectChange("f1", "src/hello.ts");
    return pending === "NOTES.md,src/hello.ts" && fs.readFileSync(path.join(dir, "src/hello.ts"), "utf8").includes("greet(");
  });

  await check("ask mode sends only read-only tools", async () => {
    await ft.chatFreeToken({ sessionId: "f2", mode: "ask", text: "What does math.ts do?" }, () => {});
    const r = fake.requests.at(-1);
    return r.tools.every((t: any) => !["edit_file", "write_file", "delete_file", "run_terminal_command"].includes(t.function.name));
  });

  await check("Ctrl+K via FreeToken", async () => (await ft.cmdKFreeToken({ path: "src/math.ts", language: "typescript", fileText: fs.readFileSync(path.join(dir, "src/math.ts"), "utf8"), start: 1, end: 3, instruction: "add types" })).replacement.includes("b: number): number"));
  await check("Tab via FreeToken uses auto-fast", async () => (await ft.completeFreeToken({ path: "x.ts", language: "typescript", prefix: "return ", suffix: "" })) === "a + b;" && fake.requests.at(-1).model === "auto-fast");

  await check("hallucinated tool rejected upstream → retried with a nudge, turn succeeds", async () => {
    const ev: AI.AgentEvent[] = [];
    const before = fake.requests.length;
    await ft.chatFreeToken({ sessionId: "f6", mode: "agent", text: "flaky tool please" }, (e) => ev.push(e));
    const err = ev.find((e) => e.type === "error") as any;
    if (err) throw new Error(err.message);
    if (fake.requests.length - before !== 2) throw new Error(`${fake.requests.length - before} requests: ${JSON.stringify(ev).slice(0, 300)}`);
    return ev.filter((e) => e.type === "text").map((e: any) => e.delta).join("").includes("FreeToken says");
  });

  await check("edit_file forgives copied `12| ` prefixes, indentation drift and trailing spaces; keeps CRLF", async () => {
    const ai = await import("../src/main/ai");
    const s = ai.getSession("fz");
    const edit = (p: string, o: string, n: string) => ai.execTool(s, "edit_file", { path: p, old_string: o, new_string: n }, () => {}, "e");
    w("py/a.py", "def f():\r\n    return 1\r\n\r\ndef g():\r\n    return 2   \r\n");
    await edit("py/a.py", "    1| def f():\n    2|     return 1", "    1| def f():\n    2|     return 10");
    await edit("py/a.py", "def g():\n  return 2", "def g():\n  return 20");
    const r = await edit("py/a.py", "return 20\n", "return 21\n").catch((e) => e.message);
    const t = fs.readFileSync(path.join(dir, "py/a.py"), "utf8");
    if (!t.includes("def f():\r\n    return 10\r\n") || !t.includes("def g():\r\n    return 21\r\n") || t.includes("|") || t.replace(/\r\n/g, "").includes("\n")) throw new Error(JSON.stringify(t) + " / " + JSON.stringify(r));
    const miss = await edit("py/a.py", "def g():\n    return 99", "x").catch((e) => e.message as string);
    return typeof miss === "string" && miss.includes("Closest match") && miss.includes("| def");
  });

  await check("a rate-limited request is waited out and the turn still succeeds", async () => {
    const events: AI.AgentEvent[] = [];
    const t0 = Date.now();
    await new Promise<void>((r) => ft.chatFreeToken({ sessionId: "busy", mode: "ask", text: "busy test please" }, (e) => { events.push(e); if (e.type === "done") r(); }));
    const waited = events.find((e) => e.type === "waiting");
    const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("");
    return !!waited && Date.now() - t0 >= 900 && text.includes("FreeToken says") && !events.some((e) => e.type === "error");
  });

  await check("a reply cut off by the output limit is dropped and asked again in smaller steps", async () => {
    const events: AI.AgentEvent[] = [];
    await new Promise<void>((r) => ft.chatFreeToken({ sessionId: "toolong", mode: "ask", text: "too long test" }, (e) => { events.push(e); if (e.type === "done") r(); }));
    const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("");
    const done = events.find((e) => e.type === "done") as any;
    return (text.includes("smaller steps") && done.stopReason === "stop" && !events.some((e) => e.type === "error")) || JSON.stringify({ text, done });
  });

  await check("the chat is told which model works on the task, and when FreeToken switches to another", async () => {
    const events: AI.AgentEvent[] = [];
    await new Promise<void>((r) => ft.chatFreeToken({ sessionId: "models", mode: "agent", text: "switch models: I have created it" }, (e) => { events.push(e); if (e.type === "done") r(); }));
    const models = events.filter((e): e is Extract<AI.AgentEvent, { type: "model" }> => e.type === "model");
    return (models.length === 2 && models[0].model === "groq/qwen/qwen3.8-27b" && models[0].task === "agent"
      && models[1].model === "kilo/nvidia/nemotron-3-ultra" && models[1].fallbacks === "groq/qwen/qwen3.8-27b (rate limit)") || JSON.stringify(models);
  });

  await check("<think> reasoning is split from the answer even when tags are cut across chunks", async () => {
    const { thinkSplitter } = await import("../src/main/ai-freetoken");
    const split = thinkSplitter();
    let text = "", think = "";
    for (const c of ["<thi", "nk>plan it", "</th", "ink>Answer <b>x</b>", " done<", "/p>"]) { const r = split(c); text += r.text; think += r.think; }
    return think === "plan it" && text === "Answer <b>x</b> done</p>";
  });

  await check("rewind restores files changed since a turn and cuts the transcript there", async () => {
    const ai = await import("../src/main/ai");
    const s = ai.getSession("rewind");
    const orig = fs.readFileSync(path.join(dir, "src/math.ts"), "utf8");
    ai.beginTurn(s, "claude", 0);
    s.messages.push({ role: "user", content: "one" }, { role: "assistant", content: "ok" });
    await ai.execTool(s, "edit_file", { path: "src/math.ts", old_string: "return a + b;", new_string: "return a + b + 0;" }, () => {}, "e1");
    ai.beginTurn(s, "claude", 2);
    s.messages.push({ role: "user", content: "two" });
    await ai.execTool(s, "edit_file", { path: "src/math.ts", old_string: "+ 0;", new_string: "+ 1;" }, () => {}, "e2");
    await ai.execTool(s, "write_file", { path: "made.txt", contents: "x" }, () => {}, "e3");
    const r1 = await ai.rewind("rewind", 1);
    const mid = fs.readFileSync(path.join(dir, "src/math.ts"), "utf8");
    const ok1 = mid.includes("+ 0;") && !fs.existsSync(path.join(dir, "made.txt")) && s.messages.length === 2 && r1!.restored.length === 2;
    await ai.rewind("rewind", 0);
    const back = fs.readFileSync(path.join(dir, "src/math.ts"), "utf8");
    return ok1 && back === orig && s.messages.length === 0 && ai.pendingChanges("rewind").length === 0 && s.turns.length === 0;
  });

  await check("repeated identical reads are short-circuited until the workspace changes", async () => {
    const ai = await import("../src/main/ai");
    const s = ai.getSession("rep");
    const read = () => ai.execTool(s, "read_file", { path: "src/math.ts" }, () => {}, "r");
    const sums = [(await read()).summary, (await read()).summary, (await read()).summary];
    await ai.execTool(s, "write_file", { path: "tmp.txt", contents: "x" }, () => {}, "w");
    const after = (await read()).summary;
    return !sums[1].startsWith("Skipped") && sums[2] === "Skipped repeated read_file" && after.startsWith("Read");
  });

  await check("long tasks are trimmed under FreeToken's 200-message limit with tool calls kept paired", () => {
    const msgs: any[] = [{ role: "user", content: "old task" }, { role: "assistant", content: "done" }, { role: "user", content: "run my app" }];
    for (let i = 0; i < 150; i++) msgs.push({ role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_file", arguments: "{}" } }] }, { role: "tool", tool_call_id: `c${i}`, content: "…" });
    const out = ft.compact(msgs, 2);
    const ids = new Set(out.flatMap((m: any) => (m.tool_calls ?? []).map((t: any) => t.id)));
    return out.length <= 120 && out[0].content === "run my app" && String(out[1].content).includes("read_file×") && out[2].role === "assistant"
      && out.filter((m: any) => m.role === "tool").every((m: any) => ids.has(m.tool_call_id)) && ft.compact(msgs.slice(0, 50), 2).length === 50;
  });

  await check("run_app starts a web server, finds its URL, opens + inspects the preview; app_input drives a CLI", async () => {
    const ai = await import("../src/main/ai");
    const runner = await import("../src/main/runner");
    const opened: string[] = [];
    runner.setPreviewHost({
      async open(u) { opened.push(u); },
      async inspect() { return opened.length ? { url: opened.at(-1)!, title: "Test App", text: "Hello from test app", console: ["[error] boom"] } : null; },
    });
    w("server.js", "const h=require('http');const s=h.createServer((q,r)=>r.end('<h1>hi</h1>'));s.listen(0,()=>console.log('ready at http://localhost:'+s.address().port));");
    w("echo.js", "process.stdin.on('data',d=>console.log('echo:'+d.toString().trim()));console.log('waiting');");
    const s = ai.getSession("run");
    s.abort = new AbortController();
    const emit = (e: AI.AgentEvent) => { if (e.type === "approval") setTimeout(() => ai.approve("run", e.id, true), 5); };
    const started = await ai.execTool(s, "run_app", { command: "node server.js" }, emit, "a1");
    const url = /http:\/\/localhost:\d+/.exec(started.content)?.[0];
    s.pageStale = true; // a file changed since the page loaded
    const page = await ai.execTool(s, "inspect_preview", {}, emit, "a2");
    // a stale page is reloaded before it's judged; an up-to-date one keeps its state (clicks made by a script)
    await ai.execTool(s, "inspect_preview", {}, emit, "a2a");
    const reloaded = opened.length === 2 && opened[1] === opened[0];
    await ai.execTool(s, "inspect_preview", { url: `${url}/about` }, emit, "a2b");
    const followed = opened.at(-1) === `${url}/about`;
    const res = url ? await fetch(url).then((r) => r.text()) : "";
    const cli = await ai.execTool(s, "run_app", { command: "node echo.js" }, emit, "a3"); // the server keeps running alongside
    const serverStill = url ? await fetch(url).then(() => true, () => false) : false;
    const typed = await ai.execTool(s, "app_input", { text: "hello" }, emit, "a4");
    const stopped = await ai.execTool(s, "stop_app", {}, emit, "a5"); // stops both
    await new Promise((r) => setTimeout(r, 1500));
    const serverDown = url ? await fetch(url).then(() => false, () => true) : false;
    runner.setPreviewHost(null);
    if (!url || opened[0] !== url || !res.includes("hi")) throw new Error(started.content);
    return page.content.includes("Hello from test app") && page.content.includes("[error] boom") && page.summary.includes("1 console")
      && reloaded && followed && serverStill && cli.content.includes("Also running: node server.js") && serverDown && typed.content.includes("echo:hello") && stopped.summary === "Stopped the app";
  });

  await check("bad token → clear message, transcript stays usable", async () => {
    token = "ft_wrong";
    const ev: AI.AgentEvent[] = [];
    await ft.chatFreeToken({ sessionId: "f3", mode: "agent", text: "hello" }, (e) => ev.push(e));
    token = "ft_test";
    const msg = (ev.find((e) => e.type === "error") as any)?.message ?? "";
    const ev2: AI.AgentEvent[] = [];
    await ft.chatFreeToken({ sessionId: "f3", mode: "agent", text: "hello again" }, (e) => ev2.push(e));
    return msg.includes("rejected the token") && ev2.some((e) => e.type === "text");
  });

  await check("server down → tells you to start FreeToken", async () => {
    ft.configureFreeToken({ url: () => "http://127.0.0.1:9/api/v1" });
    const ev: AI.AgentEvent[] = [];
    await ft.chatFreeToken({ sessionId: "f4", mode: "ask", text: "hi" }, (e) => ev.push(e));
    ft.configureFreeToken({ url: () => fake.url });
    return ((ev.find((e) => e.type === "error") as any)?.message ?? "").includes("npm run dev");
  });

  await check("missing token → asks for one", async () => {
    token = "";
    const ev: AI.AgentEvent[] = [];
    await ft.chatFreeToken({ sessionId: "f5", mode: "ask", text: "hi" }, (e) => ev.push(e));
    token = "ft_test";
    return ((ev.find((e) => e.type === "error") as any)?.message ?? "").includes("ft_");
  });

  if (process.env.FREETOKEN_LIVE_URL && process.env.FREETOKEN_LIVE_TOKEN) {
    ft.configureFreeToken({ url: () => process.env.FREETOKEN_LIVE_URL!, token: () => process.env.FREETOKEN_LIVE_TOKEN! });
    await check("LIVE: real FreeToken answers in Ask mode", async () => {
      const ev: AI.AgentEvent[] = [];
      await ft.chatFreeToken({ sessionId: "live", mode: "ask", text: "Reply with exactly: pong" }, (e) => ev.push(e));
      const err = ev.find((e) => e.type === "error") as any;
      if (err) throw new Error(err.message);
      const t = ev.filter((e) => e.type === "text").map((e: any) => e.delta).join("");
      console.log(`      live reply: ${t.slice(0, 80)}`);
      return t.length > 0;
    });
  }

  fake.close();
  console.log(failures ? `\n${failures} failed` : "\nall FreeToken checks passed");
  process.exit(failures ? 1 : 0);
}
main();
