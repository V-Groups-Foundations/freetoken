// FreeToken provider. FreeToken (github.com/varunkar2003/freetoken) is an OpenAI-compatible router
// over free AI tiers: POST {base}/chat/completions with `Authorization: Bearer ft_…`, model
// "auto-smart" / "auto-fast" / a specific id. It forwards `tools` and `stream`, and only routes
// tool-bearing requests to tool-capable models — so the full agent loop works through it.
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import {
  READ_ONLY, TOOLS, beginTurn, skillContext, toolNamesFor, execTool, getSession, loadRules, schemas, systemPrompt, toolDetail,
  type AgentEvent, type ChatRequest, type ToolName,
} from "./ai";
import { prepareAttachments, type Prepared } from "./attachments";
import { readText } from "./workspace";

export const FREETOKEN_DEFAULT_URL = "http://localhost:3000/api/v1";

let cfg = { url: () => FREETOKEN_DEFAULT_URL, token: () => "", model: () => "auto-smart" };
export const configureFreeToken = (c: Partial<typeof cfg>) => { cfg = { ...cfg, ...c }; };

function client() {
  const token = cfg.token();
  if (!token) throw new Error("Add your FreeToken API token (ft_…) in Settings — create one on FreeToken's Settings → API tokens page.");
  return new OpenAI({ apiKey: token, baseURL: cfg.url().replace(/\/+$/, ""), maxRetries: 1, timeout: 300_000 });
}

// Some free models (gpt-oss on Groq) invent built-in tools like `repo_browser.print_tree`; the
// upstream rejects the whole response. That's a sampling fluke, so the turn is retried.
const BAD_TOOL_CALL = /tool call validation failed|not in request\.tools|tool_use_failed|failed to call a function/i;

// FreeToken rejects requests with more than 200 messages. Long tasks keep the task's own request
// plus the most recent steps (starting at an assistant turn, so no tool result loses its call).
const MAX_MSGS = 120, KEEP_RECENT = 80;
export function compact<T extends { role: string }>(msgs: T[], userIndex: number): T[] {
  if (msgs.length <= MAX_MSGS) return msgs;
  let cut = Math.max(userIndex + 1, msgs.length - KEEP_RECENT);
  while (cut < msgs.length && msgs[cut].role !== "assistant") cut++;
  const dropped = msgs.slice(userIndex + 1, cut);
  const used = new Map<string, number>();
  for (const m of dropped) for (const tc of (m as { tool_calls?: { function?: { name: string } }[] }).tool_calls ?? []) if (tc.function) used.set(tc.function.name, (used.get(tc.function.name) ?? 0) + 1);
  const note = { role: "user", content: `(${dropped.length} earlier messages of this task were removed to stay under the message limit — tools used: ${[...used].map(([k, v]) => `${k}×${v}`).join(", ") || "none"}. Continue from the latest state below; re-read a file only if you need it.)` } as unknown as T;
  return [msgs[userIndex], note, ...msgs.slice(cut)];
}

export function describeFreeTokenError(e: unknown): string {
  if (BAD_TOOL_CALL.test(String((e as Error)?.message))) return "The free model kept calling tools that don't exist. Try again, or pick a different model in Settings → FreeToken.";
  if (e instanceof OpenAI.AuthenticationError) return "FreeToken rejected the token. Create a new one in FreeToken → Settings → API tokens.";
  if (e instanceof OpenAI.APIConnectionError) return `Can't reach FreeToken at ${cfg.url()}. Start it with "npm run dev" in the free_token folder.`;
  if (e instanceof OpenAI.RateLimitError) return "FreeToken: every connected provider is rate-limited right now — try again shortly or connect more keys.";
  if (e instanceof OpenAI.APIError) return `FreeToken error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export async function listModels(): Promise<string[]> {
  const page = await client().models.list();
  return page.data.map((m) => m.id);
}

const OA_TOOLS: ChatCompletionTool[] = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description ?? "", parameters: t.input_schema as Record<string, unknown> },
}));

// OpenAI-format transcripts, kept separately from the Claude ones (switching provider starts fresh history).
const transcripts = new Map<string, ChatCompletionMessageParam[]>();
export const resetFreeTokenSession = (id: string) => transcripts.delete(id);
export function seedFreeToken(id: string, turns: { role: "user" | "assistant"; content: string }[]) {
  transcripts.set(id, turns.map((t) => ({ role: t.role, content: t.content })));
}
export function truncateFreeToken(id: string, n: number) { const m = transcripts.get(id); if (m) m.length = Math.min(m.length, n); }

/**
 * Many open models stream their reasoning inline as <think>…</think>. Split it from the answer, coping with
 * tags cut across chunks.
 */
/**
 * How long to wait before retrying, or null to give up: rate limits (429) up to 6 times, honouring
 * Retry-After; a provider's passing server error (5xx) twice, briefly.
 */
export function rateLimitWait(e: unknown, waits: number): number | null {
  const err = e as { status?: number; headers?: Headers | Record<string, string> } | null;
  if (err?.status && err.status >= 500 && err.status < 600) return waits < 2 ? 2000 * (waits + 1) : null;
  if (err?.status !== 429 || waits >= 6) return null;
  const h = err.headers;
  const raw = h instanceof Headers ? h.get("retry-after") : h?.["retry-after"];
  const s = Number(raw);
  return Math.min(30_000, Number.isFinite(s) && s > 0 ? s * 1000 : 4000 * 2 ** waits);
}
const sleepUnlessAborted = (ms: number, signal: AbortSignal) => new Promise<void>((r) => {
  const t = setTimeout(r, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
});

export function thinkSplitter() {
  let inside = false, pending = "";
  return (chunk: string) => {
    let s = pending + chunk, text = "", think = "";
    pending = "";
    while (s) {
      const tag = inside ? "</think>" : "<think>";
      const i = s.indexOf(tag);
      if (i >= 0) {
        if (inside) think += s.slice(0, i); else text += s.slice(0, i);
        s = s.slice(i + tag.length);
        inside = !inside;
        continue;
      }
      let keep = 0; // a partial tag at the end waits for the next chunk
      for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) { keep = k; break; }
      if (inside) think += s.slice(0, s.length - keep); else text += s.slice(0, s.length - keep);
      pending = s.slice(s.length - keep);
      s = "";
    }
    return { text, think };
  };
}

const clip = (s: string, n: number) => (s.length > n ? `…(${s.length - n} chars omitted)…\n${s.slice(-n)}` : s);

export async function chatFreeToken(req: ChatRequest, emit: (e: AgentEvent) => void) {
  const s = getSession(req.sessionId); // shared: checkpoints, approvals, abort
  s.abort = new AbortController();
  s.seen.clear();
  s.idlePolls = 0;
  let msgs = transcripts.get(req.sessionId);
  if (!msgs) transcripts.set(req.sessionId, (msgs = []));
  const allowed = toolNamesFor(req);
  const tools = OA_TOOLS.filter((t) => t.type === "function" && allowed.has(t.function.name));

  const ctx: string[] = [];
  const c = req.context;
  if (c?.activeFile) ctx.push(`Currently open file: ${c.activeFile}`);
  if (c?.openFiles?.length) ctx.push(`Open tabs: ${c.openFiles.join(", ")}`);
  if (c?.selection?.text) ctx.push(`Selected code (${c.selection.path}:${c.selection.start}-${c.selection.end}):\n\`\`\`\n${c.selection.text}\n\`\`\``);
  for (const f of c?.mentionedFiles ?? []) {
    try { ctx.push(`@${f}:\n\`\`\`\n${clip(await readText(f), 30_000)}\n\`\`\``); } catch (e) { ctx.push(`@${f}: (could not read: ${(e as Error).message})`); }
  }
  let att: Prepared = { images: [], texts: [], note: "" };
  try { att = await prepareAttachments(req.attachments); } catch (e) { ctx.push(`(The user's attachments couldn't be saved: ${(e as Error).message})`); }
  ctx.push(...(await skillContext(s, req, emit)), ...att.texts);
  if (att.note) ctx.push(att.note);
  const userIndex = msgs.length;
  emit({ type: "turn_start", index: beginTurn(s, "ft", msgs.length) });
  const userText = ctx.length ? `<context>\n${ctx.join("\n\n")}\n</context>\n\n${req.text}` : req.text;
  // images go to the model as image parts (FreeToken routes them to a model that can see)
  msgs.push({ role: "user", content: att.images.length
    ? [{ type: "text", text: userText }, ...att.images.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mime};base64,${i.data}` } }))]
    : userText });

  try {
    const system = await systemPrompt(req.mode, msgs.filter((m) => m.role === "user" && typeof m.content === "string").slice(-4).map((m) => String(m.content).slice(-2000)).join("\n"), req.worker);
    for (let turn = 0; turn < 60; turn++) {
      let text = "";
      let calls: { id: string; name: string; args: string }[] = [];
      let finish: string | null = null;
      let waits = 0;
      for (let attempt = 0; ; attempt++) {
        text = ""; calls = []; finish = null;
        const nudge = attempt ? `\n\nIMPORTANT: call only these tools, by their exact names: ${tools.map((t) => t.type === "function" ? t.function.name : "").join(", ")}. No other tools exist (there is no repo_browser).` : "";
        try {
          const stream = await client().chat.completions.create({
            model: cfg.model() || "auto-smart",
            messages: [{ role: "system", content: system + nudge }, ...compact(msgs, userIndex)],
            tools,
            stream: true,
          }, { signal: s.abort.signal, maxRetries: 0 }); // retries happen below, visibly (rateLimitWait)
          let usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
          const split = thinkSplitter();
          for await (const chunk of stream) {
            if (chunk.usage) usage = chunk.usage;
            const ch = chunk.choices?.[0];
            if (!ch) continue;
            const d = ch.delta as typeof ch.delta & { reasoning_content?: string | null; reasoning?: string | null };
            const reasoning = d?.reasoning_content ?? d?.reasoning;
            if (reasoning) emit({ type: "thinking", delta: reasoning });
            if (d?.content) {
              const part = split(d.content);
              if (part.think) emit({ type: "thinking", delta: part.think });
              if (part.text) { text += part.text; emit({ type: "text", delta: part.text }); }
            }
            for (const tc of d?.tool_calls ?? []) {
              const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name += tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
            }
            if (ch.finish_reason) finish = ch.finish_reason;
          }
          if (usage) emit({ type: "usage", input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 });
          break;
        } catch (e) {
          // free tiers rate-limit often and briefly: wait it out instead of failing the whole task
          const wait = rateLimitWait(e, waits);
          if (wait !== null && !s.abort.signal.aborted) {
            waits++;
            attempt--; // a wait isn't a bad-tool retry
            emit({ type: "waiting", seconds: Math.max(1, Math.round(wait / 1000)), reason: "Free models are busy" });
            await sleepUnlessAborted(wait, s.abort.signal);
            if (s.abort.signal.aborted) throw e;
            continue;
          }
          if (attempt >= 2 || s.abort.signal.aborted || !BAD_TOOL_CALL.test(String((e as Error)?.message))) throw e;
          if (text) emit({ type: "text", delta: "\n\n" });
        }
      }

      // GPT-OSS models sometimes leak their channel markup into the name ("write_file<|channel|>commentary")
      const uses = calls.filter(Boolean).map((cl, i) => ({ ...cl, name: cl.name.split("<|")[0].trim(), id: cl.id || `call_${turn}_${i}` }));
      msgs.push({
        role: "assistant",
        content: text || null,
        ...(uses.length ? { tool_calls: uses.map((u) => ({ id: u.id, type: "function" as const, function: { name: u.name, arguments: u.args || "{}" } })) } : {}),
      });
      if (!uses.length) return emit({ type: "done", stopReason: finish ?? "stop" });
      if (finish === "length") throw new Error("A tool call was cut off by the output limit. Try a smaller step.");

      for (const u of uses) {
        let input: unknown = {};
        try { input = JSON.parse(u.args || "{}"); } catch { input = undefined; }
        emit({ type: "tool_start", id: u.id, name: u.name, input });
        const schema = schemas[u.name as ToolName];
        const parsed = input === undefined ? null : schema?.safeParse(input);
        let content: string;
        if (!schema || !allowed.has(u.name)) {
          content = `Unknown or unavailable tool: ${u.name}`;
          emit({ type: "tool_end", id: u.id, ok: false, summary: content });
        } else if (!parsed?.success) {
          content = `Invalid arguments for ${u.name}: ${parsed ? parsed.error.issues.map((i) => i.message).join("; ") : "not valid JSON"}. Retry with valid JSON matching the schema.`;
          emit({ type: "tool_end", id: u.id, ok: false, summary: "Invalid tool call" });
        } else {
          try {
            const r = await execTool(s, u.name as ToolName, parsed.data, emit, u.id);
            content = r.content;
            emit({ type: "tool_end", id: u.id, ok: true, summary: r.summary, detail: toolDetail(u.name, r) });
          } catch (e) {
            content = `Error: ${(e as Error).message}`;
            emit({ type: "tool_end", id: u.id, ok: false, summary: (e as Error).message });
          }
        }
        msgs.push({ role: "tool", tool_call_id: u.id, content });
      }
      if (s.abort.signal.aborted) return emit({ type: "done", stopReason: "aborted" });
    }
    emit({ type: "error", message: "Stopped after 60 steps." });
    emit({ type: "done", stopReason: "max_turns" });
  } catch (e) {
    // keep the transcript valid: answer any dangling tool calls; drop an unanswered user turn
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant" && "tool_calls" in last && last.tool_calls?.length) {
      for (const tc of last.tool_calls) msgs.push({ role: "tool", tool_call_id: tc.id, content: "Interrupted." });
    } else if (msgs.length === userIndex + 1 && !s.abort.signal.aborted) {
      msgs.pop();
    }
    if (s.abort.signal.aborted) return emit({ type: "done", stopReason: "aborted" });
    emit({ type: "error", message: describeFreeTokenError(e) });
    emit({ type: "done", stopReason: "error" });
  } finally {
    // images are big: later turns keep the text and the saved paths, not the pictures
    if (att.images.length && msgs[userIndex]?.role === "user") msgs[userIndex] = { role: "user", content: `${userText}\n\n(${att.images.length} image${att.images.length > 1 ? "s were" : " was"} shown with this message; the files are in .v-run/uploads.)` };
  }
}

const stripFences = (t: string) => { const m = t.match(/```[\w+-]*\r?\n([\s\S]*?)\r?\n?```/); return m ? m[1] : t; };

export async function cmdKFreeToken(req: { path: string; language: string; fileText: string; start: number; end: number; instruction: string }) {
  const lines = req.fileText.split(/\r?\n/);
  const before = lines.slice(Math.max(0, req.start - 81), req.start - 1).join("\n");
  const selected = lines.slice(req.start - 1, req.end).join("\n");
  const after = lines.slice(req.end, req.end + 80).join("\n");
  const rules = await loadRules();
  const r = await client().chat.completions.create({
    model: cfg.model() || "auto-smart",
    messages: [
      { role: "system", content: `You rewrite a selected region of a file according to an instruction. Reply with ONLY the replacement code for the selected region, inside one fenced code block. Keep the file's indentation and style.${rules ? `\n\nProject rules:\n${rules}` : ""}` },
      { role: "user", content: `File: ${req.path} (${req.language})\n\nBefore:\n\`\`\`\n${before}\n\`\`\`\n\nSELECTED REGION (lines ${req.start}-${req.end}):\n\`\`\`\n${selected}\n\`\`\`\n\nAfter:\n\`\`\`\n${after}\n\`\`\`\n\nInstruction: ${req.instruction}` },
    ],
  });
  return { replacement: stripFences(r.choices[0]?.message?.content ?? ""), original: selected };
}

export async function completeFreeToken(req: { path: string; language: string; prefix: string; suffix: string }, signal?: AbortSignal) {
  const r = await client().chat.completions.create({
    model: "auto-fast",
    max_tokens: 200,
    messages: [
      { role: "system", content: "You are a code completion engine. Reply with ONLY the text to insert at <CURSOR> — no explanation, no code fences, no repetition of existing code. Reply with nothing if no completion is useful." },
      { role: "user", content: `File: ${req.path} (${req.language})\n<code>\n${req.prefix.slice(-4000)}<CURSOR>${req.suffix.slice(0, 1500)}\n</code>` },
    ],
  }, { signal });
  return stripFences(r.choices[0]?.message?.content ?? "").replace(/^<CURSOR>/, "");
}
