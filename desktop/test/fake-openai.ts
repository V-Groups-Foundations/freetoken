// A scripted stand-in for an OpenAI-compatible server (FreeToken's /api/v1): streams `content`
// and `tool_calls` deltas in the real chat.completion.chunk SSE format.
import http from "node:http";

type Block = { type: "text"; text: string } | { type: "tool"; name: string; args: unknown };

const lastUserText = (body: any) => {
  for (let i = body.messages.length - 1; i >= 0; i--) if (body.messages[i].role === "user") {
    const c = body.messages[i].content; // a message with images is a list of parts
    const text = Array.isArray(c) ? c.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") : String(c);
    // script on what the user typed, not on context V-Run added (open files, skills that matched…)
    return text.replace(/<context>[\s\S]*<\/context>\s*/, "");
  }
  return "";
};

/** Team mode: a supervisor and two workers (api, web) — see test/team.test.ts. */
/** Decide the next reply from the request: which agent (by system prompt) and how far it got. */
export function teamScript(body: any): Block[] | null {
  const sys = String(body.messages[0]?.content ?? "");
  const msgs = body.messages as any[];
  const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
  const step = msgs.slice(lastUser).filter((m) => m.role === "assistant").length;
  const lastTool = [...msgs].reverse().find((m) => m.role === "tool")?.content ?? "";
  if (sys.includes("Team mode — you are the supervisor")) {
    const steps: Block[][] = [
      [{ type: "text", text: "Splitting this in two." },
        { type: "tool", name: "spawn_agent", args: { name: "api", task: "Create src/api.ts exporting getUser().", files: ["src/api.ts"] } },
        { type: "tool", name: "spawn_agent", args: { name: "web", task: "Create src/web.ts that calls getUser().", files: ["src/web.ts"] } }],
      [{ type: "tool", name: "wait_for_agents", args: { timeout_seconds: 60 } }],
      lastTool.includes("api asks") ? [{ type: "tool", name: "message_agent", args: { agent: "api", message: "Yes, make it async." } }] : [{ type: "text", text: `unexpected: ${lastTool.slice(0, 200)}` }],
      [{ type: "tool", name: "wait_for_agents", args: { timeout_seconds: 60 } }],
      [{ type: "text", text: `Team finished. ${lastTool.replace(/\s+/g, " ")}` }],
    ];
    return steps[Math.min(step, steps.length - 1)];
  }
  if (sys.includes('You are agent "api"')) {
    const steps: Block[][] = [
      [{ type: "tool", name: "write_file", args: { path: "src/api.ts", contents: "export function getUser() { return { id: 1 }; }\n" } }],
      [{ type: "tool", name: "ask_supervisor", args: { question: "Should getUser be async?" } }],
      [{ type: "tool", name: "write_file", args: { path: "src/api.ts", contents: `// ${lastTool.includes("async") ? "async per supervisor" : "sync"}\nexport async function getUser() { return { id: 1 }; }\n` } }],
      [{ type: "text", text: "api report: wrote src/api.ts (async getUser)." }],
    ];
    return steps[Math.min(step, steps.length - 1)];
  }
  if (sys.includes('You are agent "web"')) {
    const steps: Block[][] = [
      [{ type: "tool", name: "write_file", args: { path: "src/web.ts", contents: "import { getUser } from './api';\nconsole.log(getUser());\n" } }],
      [{ type: "tool", name: "edit_file", args: { path: "src/api.ts", old_string: "return { id: 1 }", new_string: "return { id: 2 }" } }],
      [{ type: "text", text: `web report: wrote src/web.ts; editing api.ts was ${String(lastTool).includes("🔒") ? "BLOCKED" : "allowed"}.` }],
    ];
    return steps[Math.min(step, steps.length - 1)];
  }
  return null;
}


/** Same scenario as the Claude fake: rename greet → sayHello over several tool turns. */
export function freeTokenScript(body: any): Block[] {
  const team = teamScript(body);
  if (team) return team;
  const sys = String(body.messages[0]?.content ?? "");
  if (sys.includes("code completion")) return [{ type: "text", text: "a + b;" }];
  if (sys.includes("rewrite a selected region")) return [{ type: "text", text: "```ts\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n```" }];
  const text = lastUserText(body);
  const sinceUser = () => body.messages.slice(body.messages.map((m: any) => m.role).lastIndexOf("user")).filter((m: any) => m.role === "assistant").length;
  if (sys.includes("Plan mode")) {
    // reasoning arrives inline as <think>…</think>, split across chunks like real open models
    const steps: Block[][] = [
      [{ type: "text", text: "<think>They want a farewell helper. I should check hello.ts first.</think>Let me look at the code." }, { type: "tool", name: "read_file", args: { path: "src/hello.ts" } }],
      [{ type: "text", text: "Plan:\n1. Add `farewell` in `src/farewell.ts`\n2. Verify it compiles" }],
    ];
    return steps[Math.min(sinceUser(), steps.length - 1)];
  }
  if (/carry out the plan/i.test(text)) {
    const steps: Block[][] = [
      [{ type: "tool", name: "write_file", args: { path: "src/farewell.ts", contents: "export const farewell = (n: string) => `Bye ${n}`;\n" } }],
      [{ type: "text", text: "Built the plan: added `src/farewell.ts`." }],
    ];
    return steps[Math.min(sinceUser(), steps.length - 1)];
  }
  if (/run the app/i.test(text)) {
    const lastUser = body.messages.map((m: any) => m.role).lastIndexOf("user");
    const turns = body.messages.slice(lastUser).filter((m: any) => m.role === "assistant").length;
    const steps: Block[][] = [
      [{ type: "tool", name: "run_app", args: { command: "node server.js", explanation: "Start the web app" } }],
      [{ type: "tool", name: "inspect_preview", args: {} }],
      [{ type: "text", text: "Your app is running in the preview (checked the page)." }],
    ];
    return steps[Math.min(turns, steps.length - 1)];
  }
  if (/rename/i.test(text)) {
    const turns = body.messages.filter((m: any) => m.role === "assistant").length;
    const steps: Block[][] = [
      [{ type: "text", text: "Looking for it." }, { type: "tool", name: "todo_write", args: { todos: [{ content: "Rename greet to sayHello", status: "in_progress" }] } },
        { type: "tool", name: "codebase_search", args: { query: "greet function" } }],
      [{ type: "tool", name: "read_file", args: { path: "src/hello.ts" } }],
      [{ type: "tool", name: "edit_file", args: { path: "src/hello.ts", old_string: "export function greet(", new_string: "export function sayHello(" } }],
      [{ type: "tool", name: "write_file", args: { path: "NOTES.md", contents: "# Notes\nRenamed via FreeToken.\n" } }],
      [{ type: "tool", name: "run_terminal_command", args: { command: "echo verified", explanation: "Check the shell" } }],
      [{ type: "tool", name: "run_terminal_command", args: { command: "echo second", explanation: "Second command" } }],
      [{ type: "text", text: "Renamed **greet** to **sayHello** (via FreeToken)." }],
    ];
    return steps[Math.min(turns, steps.length - 1)];
  }
  return [{ type: "text", text: `FreeToken says: ${text.replace(/<context>[\s\S]*<\/context>\s*/, "").slice(0, 80)}` }];
}

type FakeProject = { name: string; model: string; messages: { role: string; content: string; provider?: string | null }[] };

// Minimal FreeToken pages for V-Run's embedded view: they use window.vrun exactly like the real ones.
const page = (title: string, body: string) => `<!doctype html><title>${title}</title><h1>${title}</h1>${body}
<p id="out"></p><script>const out = (t) => (document.getElementById("out").textContent = t);</script>`;
const PAGES: Record<string, string> = {
  "/": page("FreeToken home", `<p>Your models and projects.</p><button id="focus" onclick="window.vrun.focus().then(() => out('focused'), (e) => out('error: ' + e.message))">Back to V-Run</button>`),
  "/v-run": page("Connect V-Run", `<button id="connect" onclick="window.vrun.connect('ft_test').then(() => out('connected'), (e) => out('error: ' + e.message))">Connect V-Run</button>`),
};

export function startFakeOpenAI(token = "ft_test"): Promise<{ url: string; requests: any[]; projects: Map<string, FakeProject>; close: () => void }> {
  const requests: any[] = [];
  const projects = new Map<string, FakeProject>();
  const busySeen = new Set<string>();
  let n = 0;
  const server = http.createServer((req, res) => {
    const pathOnly = (req.url ?? "/").split("?")[0];
    const proj = pathOnly.match(/^\/projects\/([\w-]+)$/);
    if (req.method === "GET" && (PAGES[pathOnly] || proj)) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PAGES[pathOnly] ?? page(`Project ${proj![1]}`, `<button id="continue" onclick="window.vrun.openProject('${proj![1]}').then(() => out('opened'), (e) => out('error: ' + e.message))">Continue in V-Run</button>`));
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Missing or invalid FreeToken API token.", type: "authentication_error", code: "invalid_api_key" } }));
    }
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: ["auto-smart", "auto-fast", "groq/llama-3.3-70b"].map((id) => ({ id, object: "model", owned_by: "freetoken" })) }));
    }
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (pathOnly === "/api/projects") {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.method === "POST") {
          const id = `p-new-${++n}`;
          projects.set(id, { name: body.name, model: "auto-smart", messages: [] });
          return res.end(JSON.stringify({ id, name: body.name, model: "auto-smart" }));
        }
        return res.end(JSON.stringify([...projects].reverse().map(([id, p]) => ({ id, name: p.name, model: p.model, updatedAt: new Date().toISOString() }))));
      }
      if (pathOnly === "/api/usage") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ today: { requests: 42, tokens: 12345 }, knownRemainingRequests: 958, overall: { used: 300, limit: 1200, remaining: 900, limits: 3, live: 1, resetAt: new Date(Date.now() + 5 * 3600_000).toISOString() }, providers: [
          { provider: "groq", name: "Groq", status: "ok", account: null, models: [{ requests: 30 }, { requests: 12 }] },
          { provider: "openrouter", name: "OpenRouter", status: "ok", account: { used: 8, limit: 50 }, models: [{ requests: 8 }] },
        ] }));
      }
      const pm = pathOnly.match(/^\/api\/projects\/([\w-]+)\/messages$/);
      if (pm) {
        const p = projects.get(pm[1]);
        res.writeHead(p ? 200 : 404, { "content-type": "application/json" });
        if (!p) return res.end(JSON.stringify({ error: "Project not found." }));
        if (req.method === "POST") { p.messages.push(...body.messages); return res.end(JSON.stringify({ added: body.messages.length })); }
        return res.end(JSON.stringify({ project: { id: pm[1], name: p.name, model: p.model }, messages: p.messages }));
      }
      requests.push(body);
      // mimic every free provider being rate-limited for a moment (once per "busy test" message)
      if (/busy test/i.test(lastUserText(body)) && !busySeen.has(lastUserText(body))) {
        busySeen.add(lastUserText(body));
        res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
        return res.end(JSON.stringify({ error: { message: "All providers are rate-limited.", type: "rate_limit_error" } }));
      }
      // mimic Groq rejecting a hallucinated tool on the first try (as relayed by FreeToken)
      if (/flaky tool/i.test(lastUserText(body)) && !String(body.messages[0]?.content).includes("IMPORTANT: call only")) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Tool call validation failed: attempted to call tool 'repo_browser.print_tree' which was not in request.tools", type: "invalid_request_error", code: "tool_use_failed" } }));
      }
      const blocks = freeTokenScript(body);
      const id = `chatcmpl-${++n}`;
      const base = { id, object: "chat.completion.chunk", created: 0, model: "fake/model" };
      const hasTools = blocks.some((b) => b.type === "tool");
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        const content = blocks.filter((b) => b.type === "text").map((b: any) => b.text).join("");
        return res.end(JSON.stringify({ id, object: "chat.completion", created: 0, model: "fake/model", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: "assistant", content: "" });
      let ti = 0;
      for (const b of blocks) {
        if (b.type === "text") for (const piece of b.text.match(/[\s\S]{1,10}/g) ?? []) send({ content: piece });
        else {
          const args = JSON.stringify(b.args);
          const index = ti++;
          send({ tool_calls: [{ index, id: `call_${n}_${index}`, type: "function", function: { name: b.name, arguments: "" } }] });
          for (const piece of args.match(/[\s\S]{1,15}/g) ?? []) send({ tool_calls: [{ index, function: { arguments: piece } }] });
        }
      }
      send({}, hasTools ? "tool_calls" : "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${port}/api/v1`, requests, projects, close: () => server.close() });
  }));
}
