// A tiny MCP server over stdio for tests: tools "echo" and "add".
const rl = require("readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
console.error("fake-mcp starting"); // servers log to stderr
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // a notification
  if (msg.method === "initialize") return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
    { name: "echo", description: "Echo text back", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
  ] } });
  if (msg.method === "tools/call") {
    const { name, arguments: a } = msg.params;
    if (name === "echo") return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo: ${a.text}` }] } });
    if (name === "add") return send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(a.a + a.b) }] } });
    return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such tool" } });
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown method" } });
});
