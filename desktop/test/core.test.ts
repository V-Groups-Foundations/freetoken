// Core tests without Electron: workspace confinement, ignore rules, ripgrep search,
// Merkle index + BM25, and the full agent loop against the fake Messages API.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { demoScript, startFake } from "./fake-anthropic";
import type * as AI from "../src/main/ai";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-core-"));
const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
w("src/hello.ts", "export function greet(name: string) {\n  return `Hello ${name}`;\n}\n");
w("src/math.ts", "export function add(a: number, b: number) {\n  return a + b;\n}\n\nexport function multiplyNumbers(a: number, b: number) {\n  return a * b;\n}\n");
w("secret/keys.txt", "TOP SECRET\n");
w("build/out.js", "compiled greet\n");
w(".gitignore", "build/\n");
w(".cursorignore", "secret/\n");
w(".cursor/rules/style.md", "Always use 2-space indentation.\n");

async function main() {
const fake = await startFake(demoScript);
process.env.ANTHROPIC_BASE_URL = fake.url;
process.env.ANTHROPIC_API_KEY = "test-key";

const ws = await import("../src/main/workspace");
const search = await import("../src/main/search");
const idx = await import("../src/main/indexer");
const ai = await import("../src/main/ai");

let failures = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try { const r = await fn(); if (r === false) throw new Error("returned false"); console.log(`PASS  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}
const throws = async (fn: () => unknown) => { try { await fn(); return false; } catch { return true; } };

ws.setRoot(dir);

await check("paths outside the workspace are rejected", async () =>
  (await throws(() => ws.resolveInRoot("../etc/passwd"))) && (await throws(() => ws.resolveInRoot(path.join(os.tmpdir(), "x")))) &&
  ws.resolveInRoot("/src/hello.ts").rel === "src/hello.ts");
await check("a link inside the workspace can't be used to write (or read) outside it; ..-named files are fine", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-remake-outside-"));
  // a junction on Windows (no admin rights needed), a symlink elsewhere — what a cloned repo could contain
  fs.symlinkSync(outside, path.join(dir, "link"), process.platform === "win32" ? "junction" : "dir");
  const write = await ws.writeText("link/pwned.txt", "x").then(() => "written", (e) => String(e.message));
  const deep = await ws.writeText("link/a/b/c.txt", "x").then(() => "written", (e) => String(e.message));
  const read = await ws.readText("link/anything.txt").then(() => "read", (e) => String(e.message));
  fs.writeFileSync(path.join(dir, "..env"), "ok");
  const dotdot = ws.resolveInRoot("..env").rel;
  fs.rmSync(path.join(dir, "link"));
  return !fs.existsSync(path.join(outside, "pwned.txt")) && /outside the workspace/.test(write) && /outside the workspace/.test(deep)
    && /outside the workspace|ENOENT/.test(read) && dotdot === "..env";
});
await check(".gitignore and .cursorignore hide files from the tree", async () => {
  const names = (await ws.listDir(".")).map((e) => e.name);
  return names.includes("src") && !names.includes("build") && !names.includes("secret");
});
await check("ripgrep finds matches and respects ignore files", async () => {
  const { hits } = await search.grep("greet");
  return hits.length === 1 && hits[0].path === "src/hello.ts" && hits[0].line === 1;
});
await check("fuzzy file search ranks by name", async () => (await search.fuzzyFiles("math"))[0] === "src/math.ts");

await check("index builds a Merkle tree and BM25 finds code by concept", async () => {
  const s = await idx.reindex();
  const top = idx.search("multiply numbers")[0];
  return s.files >= 3 && s.rootHash.length === 64 && top?.path === "src/math.ts";
});
await check("re-index only re-chunks changed files (Merkle diff)", async () => {
  const before = idx.lastStats.rootHash;
  const same = await idx.reindex();
  w("src/math.ts", fs.readFileSync(path.join(dir, "src/math.ts"), "utf8") + "\nexport const PI = 3.14;\n");
  const after = await idx.reindex();
  return same.changedFiles === 0 && same.rootHash === before && after.changedFiles === 1 && after.rootHash !== before;
});
await check("ignored files never reach the index", () => {
  const paths = [...idx.search("TOP SECRET", 50), ...idx.search("compiled greet", 50)].map((r) => r.path);
  return !paths.some((p) => p.startsWith("secret/") || p.startsWith("build/"));
});

await check("agent loop: search → read → edit → create → approved command → summary", async () => {
  const events: AI.AgentEvent[] = [];
  const sid = "t1";
  await ai.chat({ sessionId: sid, mode: "agent", text: "Rename greet to sayHello" }, (e) => {
    events.push(e);
    if (e.type === "approval") setTimeout(() => ai.approve(sid, e.id, true), 10);
  });
  const errs = events.filter((e) => e.type === "error");
  if (errs.length) throw new Error(JSON.stringify(errs));
  const tools = events.filter((e) => e.type === "tool_end") as Extract<AI.AgentEvent, { type: "tool_end" }>[];
  const okAll = tools.every((t) => t.ok);
  const edited = fs.readFileSync(path.join(dir, "src/hello.ts"), "utf8").includes("export function sayHello(");
  const ran = tools.some((t) => t.summary.includes("echo verified") && t.summary.includes("exit code 0"));
  const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("");
  if (!okAll) throw new Error(JSON.stringify(tools.filter((t) => !t.ok)));
  return edited && ran && fs.existsSync(path.join(dir, "NOTES.md")) && text.includes("sayHello") && events.some((e) => e.type === "todos");
});
await check("rules and eager tool streaming are sent to the API", () => {
  const req = fake.requests.find((r) => r.tools);
  return String(req.system).includes("2-space indentation") && req.tools.every((t: any) => t.eager_input_streaming === true) &&
    req.fallbacks === "default" && req.output_config?.effort === "high";
});
await check("reject restores the original file and removes created files", async () => {
  const pending = ai.pendingChanges("t1").sort();
  await ai.rejectChange("t1", "src/hello.ts");
  await ai.rejectChange("t1", "NOTES.md");
  return pending.join() === "NOTES.md,src/hello.ts" && fs.readFileSync(path.join(dir, "src/hello.ts"), "utf8").includes("function greet(") &&
    !fs.existsSync(path.join(dir, "NOTES.md"));
});
await check("declined command is reported to the model, not run", async () => {
  const events: AI.AgentEvent[] = [];
  await ai.chat({ sessionId: "t2", mode: "agent", text: "Rename greet to sayHello" }, (e) => {
    events.push(e);
    if (e.type === "approval") ai.approve("t2", e.id, false);
  });
  return events.some((e) => e.type === "tool_end" && e.summary.startsWith("Declined"));
});
await check("ask mode only offers read-only tools", async () => {
  await ai.chat({ sessionId: "t3", mode: "ask", text: "What does this do?" }, () => {});
  const req = fake.requests.at(-1);
  return req.tools.every((t: any) => !["edit_file", "write_file", "delete_file", "run_terminal_command"].includes(t.name));
});
await check("Cmd+K returns replacement code with fences stripped", async () => {
  const r = await ai.cmdK({ path: "src/math.ts", language: "typescript", fileText: fs.readFileSync(path.join(dir, "src/math.ts"), "utf8"), start: 1, end: 3, instruction: "add types" });
  return r.replacement.startsWith("export function add(a: number, b: number): number {") && !r.replacement.includes("```");
});
await check("Tab completion returns insert text", async () => (await ai.complete({ path: "x.ts", language: "typescript", prefix: "return ", suffix: "" })) === "a + b;");
await check("line diff: counts, numbering, context gaps", async () => {
  const { lineDiff } = await import("../src/main/diff");
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const after = before.replace("line 3", "line three").replace("line 17\n", "") + "\nline 21";
  const d = lineDiff(before, after, 1);
  const del3 = d.lines.find((l) => l.t === "-" && l.s === "line 3"), add3 = d.lines.find((l) => l.t === "+" && l.s === "line three");
  return d.added === 2 && d.removed === 2 && del3?.a === 3 && add3?.b === 3 && d.lines.some((l) => l.s === "…") && !d.lines.some((l) => l.s === "line 10");
});
await check("edit_file / write_file report a diff for the chat card", async () => {
  const s = ai.getSession("diff");
  const e = await ai.execTool(s, "edit_file", { path: "src/math.ts", old_string: "return a + b;", new_string: "return a + b; // sum" }, () => {}, "d1");
  const w = await ai.execTool(s, "write_file", { path: "new-file.txt", contents: "a\nb\n" }, () => {}, "d2");
  const t = ai.toolDetail("grep_search", { content: "x:1:y", summary: "" });
  return e.detail?.kind === "diff" && e.detail.added === 1 && e.detail.removed === 1
    && w.detail?.kind === "diff" && !!w.detail.created && w.detail.removed === 0 && t?.kind === "output";
});

fake.close();
console.log(failures ? `\n${failures} failed` : "\nall core checks passed");
process.exit(failures ? 1 : 0);
}
main();
