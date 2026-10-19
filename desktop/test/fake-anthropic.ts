// A scripted stand-in for POST /v1/messages that speaks the real SSE event format, so the
// real SDK and our agent loop are exercised end to end without an API key or cost.
import http from "node:http";

export type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };
export type Script = (body: any) => { blocks: Block[]; stop?: string };

let n = 0;
export function startFake(script: Script, port = 0): Promise<{ url: string; requests: any[]; close: () => void }> {
  const requests: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      requests.push(body);
      const { blocks, stop } = script(body);
      const content = blocks.map((b) => (b.type === "tool_use" ? { ...b, id: `toolu_fake${++n}` } : b));
      const stopReason = stop ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn");
      const msg = { id: `msg_fake${++n}`, type: "message", role: "assistant", model: body.model, content, stop_reason: stopReason,
        stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } };
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(msg));
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { ...msg, content: [], stop_reason: null } });
      content.forEach((b: any, i) => {
        if (b.type === "text") {
          ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
          for (const piece of b.text.match(/[\s\S]{1,12}/g) ?? []) ev("content_block_delta", { index: i, delta: { type: "text_delta", text: piece } });
        } else {
          ev("content_block_start", { index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
          const json = JSON.stringify(b.input);
          for (const piece of json.match(/[\s\S]{1,20}/g) ?? []) ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: piece } });
        }
        ev("content_block_stop", { index: i });
      });
      ev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 10 } });
      ev("message_stop", {});
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const { port: p } = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${p}`, requests, close: () => server.close() });
  }));
}

/** Count tool_result blocks so far in the conversation (= how far the scripted agent got). */
export const toolResults = (body: any) =>
  body.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "tool_result");
export const lastUserText = (body: any) => {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const m = body.messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
};

/** The scenario used by both the core test and the Electron e2e test. */
export const demoScript: Script = (body) => {
  if (!body.stream && String(body.system).includes("code completion")) return { blocks: [{ type: "text", text: "a + b;" }] };
  if (String(body.system).includes("rewrite a selected region")) {
    return { blocks: [{ type: "text", text: "```ts\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n```" }] };
  }
  const text = lastUserText(body);
  const done = toolResults(body).length;
  if (/rename/i.test(text)) {
    const steps: Block[][] = [
      [{ type: "text", text: "Let me find it." }, { type: "tool_use", name: "todo_write", input: { todos: [{ content: "Rename greet to sayHello", status: "in_progress" }] } },
        { type: "tool_use", name: "codebase_search", input: { query: "greet function" } }],
      [{ type: "tool_use", name: "read_file", input: { path: "src/hello.ts" } }],
      [{ type: "tool_use", name: "edit_file", input: { path: "src/hello.ts", old_string: "export function greet(", new_string: "export function sayHello(" } }],
      [{ type: "tool_use", name: "write_file", input: { path: "NOTES.md", contents: "# Notes\nRenamed greet to sayHello.\n" } }],
      [{ type: "tool_use", name: "run_terminal_command", input: { command: "echo verified", explanation: "Check the shell works" } }],
      [{ type: "text", text: "Renamed **greet** to **sayHello** in `src/hello.ts` and added NOTES.md." }],
    ];
    // tool results come back in batches; map batch count to step
    const batches = body.messages.filter((m: any) => m.role === "user" && Array.isArray(m.content)).length;
    void done;
    return { blocks: steps[Math.min(batches, steps.length - 1)] };
  }
  return { blocks: [{ type: "text", text: `You asked: ${text.replace(/<context>[\s\S]*<\/context>\s*/, "").slice(0, 80)}` }] };
};
