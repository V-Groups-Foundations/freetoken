// FreeToken provider. FreeToken (github.com/varunkar2003/freetoken) is an OpenAI-compatible router
// over free AI tiers: POST {base}/chat/completions with `Authorization: Bearer ft_…`, model
// "auto-smart" / "auto-fast" / a specific id. It forwards `tools` and `stream`, and only routes
// tool-bearing requests to tool-capable models — so the full agent loop works through it.
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import {
  READ_ONLY, TOOLS, MAX_STEPS, beginTurn, buildNudge, regressionGate, startTurnState, stepsLeftNote, skillContext, toolNamesFor, execTool, getSession, loadRules, schemas, systemPrompt, toolDetail,
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

// ---------------------------------------------------------------- long tasks: summarise, don't forget
// Past ~120 messages or ~160k characters of context, the older steps of the task are replaced by a
// running summary that a fast model writes (goal, decisions, files and what's in them, how to run it,
// errors fixed, open problems). It's updated in chunks — the kept part shrinks back to ~80 messages /
// 80k characters — so it isn't rewritten on every step. If summarising fails, compact()'s note is used.

const MAX_CHARS = 160_000, KEEP_CHARS = 80_000;
type Summary = { userIndex: number; upTo: number; text: string };
const summaries = new Map<string, Summary>();
const sizeOf = (m: unknown) => JSON.stringify(m).length;
const charsOf = (ms: unknown[]) => ms.reduce<number>((n, m) => n + sizeOf(m), 0);

/** Where the kept recent part starts: at most KEEP_RECENT messages / KEEP_CHARS characters, at an assistant turn. */
export function keepFrom(msgs: { role: string }[], userIndex: number) {
  let i = msgs.length, chars = 0;
  while (i > userIndex + 1 && msgs.length - (i - 1) <= KEEP_RECENT && chars + sizeOf(msgs[i - 1]) <= KEEP_CHARS) chars += sizeOf(msgs[--i]);
  while (i < msgs.length && msgs[i].role !== "assistant") i++; // never start with a tool result that lost its call
  return i;
}

/** The steps being dropped, as compact text for the summariser. */
function transcriptText(ms: ChatCompletionMessageParam[]) {
  const text = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join(" ") : "");
  const lines = ms.map((m) => {
    if (m.role === "tool") return `  → ${text(m.content).slice(0, 500)}`;
    if (m.role === "assistant") {
      const calls = ("tool_calls" in m ? m.tool_calls ?? [] : []).map((t: any) => `${t.function?.name}(${String(t.function?.arguments ?? "").slice(0, 300)})`);
      return `assistant: ${text(m.content).slice(0, 800)}${calls.length ? `\n  calls: ${calls.join("; ")}` : ""}`;
    }
    return `${m.role}: ${text(m.content).slice(0, 1500)}`;
  });
  const all = lines.join("\n");
  return all.length > 60_000 ? `…(earliest part cut)…\n${all.slice(-60_000)}` : all;
}

const SUMMARY_BRIEF = "You keep the working notes of an AI coding agent that is in the middle of a long task. Write the notes it needs to carry on without the steps below: the goal, decisions made, every file created or changed and what is in it (exact paths, key functions, ids, ports, URLs), how to run and test it, errors met and how they were fixed, what is still broken or unverified, and what it was about to do next. Keep names, paths and numbers exact. Plain bullet points, at most 450 words. Update the existing notes if given: keep what still holds, drop what's obsolete.";

async function summarise(previous: string | undefined, dropped: ChatCompletionMessageParam[], signal?: AbortSignal) {
  const r = await client().chat.completions.create({
    model: "auto-fast",
    max_tokens: 1000,
    messages: [
      { role: "system", content: SUMMARY_BRIEF },
      { role: "user", content: `${previous ? `Existing notes:\n${previous}\n\n` : ""}Steps to fold into the notes:\n${transcriptText(dropped)}` },
    ],
  }, { signal, timeout: 120_000, maxRetries: 1 });
  const text = r.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("empty summary");
  return text;
}

/**
 * What to send for this step: the whole transcript while it's small; once it's long, the task's request,
 * the running summary of the older steps, and the recent steps.
 */
export async function contextFor(id: string, msgs: ChatCompletionMessageParam[], userIndex: number, signal?: AbortSignal, onSummarise?: () => void): Promise<ChatCompletionMessageParam[]> {
  let sum = summaries.get(id);
  if (sum && (sum.userIndex !== userIndex || sum.upTo > msgs.length)) { summaries.delete(id); sum = undefined; }
  const from = sum ? sum.upTo : userIndex + 1;
  const withSummary = (s: Summary) => [msgs[userIndex], { role: "user" as const, content: `(Earlier steps of this task were summarised to keep the context small. Your notes so far:\n${s.text}\n\nContinue from the latest state below; re-read a file if you need its exact contents.)` }, ...msgs.slice(s.upTo)];
  const tooBig = msgs.length - from > MAX_MSGS || charsOf(msgs.slice(from)) > MAX_CHARS;
  if (!tooBig) return sum ? withSummary(sum) : msgs;
  const upTo = keepFrom(msgs, userIndex);
  if (upTo <= from) return sum ? withSummary(sum) : compact(msgs, userIndex);
  // the first summary of a task also folds in the conversation before it
  const dropped = sum ? msgs.slice(from, upTo) : [...msgs.slice(0, userIndex), ...msgs.slice(userIndex + 1, upTo)];
  onSummarise?.();
  try {
    const next = { userIndex, upTo, text: await summarise(sum?.text, dropped, signal) };
    summaries.set(id, next);
    return withSummary(next);
  } catch {
    if (signal?.aborted) throw new Error("aborted");
    return compact(msgs, userIndex); // the summariser is busy: fall back to cutting with a note
  }
}

export function describeFreeTokenError(e: unknown): string {
  if (BAD_TOOL_CALL.test(String((e as Error)?.message))) return "The free model kept calling tools that don't exist. Try again, or pick a different model in Settings → FreeToken.";
  if (e instanceof OpenAI.AuthenticationError) return "FreeToken rejected the token. Create a new one in FreeToken → Settings → API tokens.";
  if (e instanceof OpenAI.APIConnectionError) return `Can't reach FreeToken at ${cfg.url()}. Start it with "npm run dev" in the free_token folder.`;
  // FreeToken never 404s its own API: something else (often a static server like `npx serve`) took its port
  if (e instanceof OpenAI.NotFoundError && !/model/i.test(e.message)) return `Something other than FreeToken is answering at ${cfg.url()} (${e.message.replace(/^404\s*/, "")}) — usually a web server an app or agent started on FreeToken's port. Stop that program, start FreeToken again ("npm run dev" in the free_token folder), then Retry.`;
  if (e instanceof OpenAI.RateLimitError) return "FreeToken: every connected provider is rate-limited right now — try again shortly or connect more keys.";
  if (e instanceof OpenAI.APIError) return `FreeToken error ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** How FreeToken's auto routing ranks the user's models for a kind of task (null on an older FreeToken). */
export async function routerScores(task = "agent"): Promise<{ task: string; models: { model: string; tier: string; quality: number; learned: number; score: number }[] } | null> {
  const token = cfg.token();
  if (!token) return null;
  const r = await fetch(`${cfg.url().replace(/\/+$/, "")}/router/scores?task=${encodeURIComponent(task)}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  return r?.ok ? r.json() : null;
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
export const resetFreeTokenSession = (id: string) => { summaries.delete(id); return transcripts.delete(id); };
export function seedFreeToken(id: string, turns: { role: "user" | "assistant"; content: string }[]) {
  transcripts.set(id, turns.map((t) => ({ role: t.role, content: t.content })));
}
/** The conversation so far (to save it), and putting a saved one back (after a reload or restart). */
export const getTranscript = (id: string) => transcripts.get(id) ?? [];
export function restoreTranscript(id: string, msgs: unknown[]) { if (!transcripts.get(id)?.length && msgs.length) transcripts.set(id, msgs as ChatCompletionMessageParam[]); }
export function truncateFreeToken(id: string, n: number) { const m = transcripts.get(id); if (m) m.length = Math.min(m.length, n); }

/**
 * Many open models stream their reasoning inline as <think>…</think>. Split it from the answer, coping with
 * tags cut across chunks.
 */
/**
 * How long to wait before retrying, or null to give up: rate limits (429) up to 6 times, honouring
 * Retry-After; a provider's passing server error (5xx) twice, briefly.
 */
/** The answer stream broke off mid-way ("Upstream idle timeout exceeded", a reset connection). */
export function brokeOff(e: unknown) {
  const status = (e as { status?: number } | null)?.status;
  return (!status || status === 408) && /idle timeout|timed? ?out|ECONNRESET|socket hang up|terminated|premature close|fetch failed|network error|stream (closed|ended|interrupted)|aborted by the server/i.test(String((e as Error)?.message ?? ""));
}
// what usually breaks a stream is one enormous reply (a whole app in a single write_file): ask for parts
const CUT_OFF = "\n\nIMPORTANT: your last reply was cut off by the provider while you were writing it — it was too long for one step. Write big files in parts: first write_file a skeleton (structure plus the first section, under ~250 lines), then add each further section with edit_file in its own step.";

export function rateLimitWait(e: unknown, waits: number): number | null {
  const err = e as { status?: number; headers?: Headers | Record<string, string> } | null;
  // FreeToken couldn't reach any provider from this network: retrying here won't change that
  if (/couldn't be reached from this network|network_unreachable/i.test(String((e as Error)?.message ?? ""))) return null;
  if (err?.status && err.status >= 500 && err.status < 600) return waits < 2 ? 2000 * (waits + 1) : null;
  // a stream that broke off mid-answer ("Upstream idle timeout exceeded", a reset connection): free
  // providers drop long generations now and then — ask again rather than ending the whole task
  if (brokeOff(e)) return waits < 3 ? 1500 * (waits + 1) : null;
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

const PROVIDER_NAMES: Record<string, string> = { gemini: "Gemini (Google)", groq: "Groq", openrouter: "OpenRouter", github: "GitHub Models", cohere: "Cohere", nvidia: "NVIDIA", cloudflare: "Cloudflare" };
/** What to tell the user when FreeToken couldn't reach providers from their network. */
export function unreachableMessage(providers: string[]) {
  const names = providers.map((p) => PROVIDER_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `${list} couldn't be reached from this network — you might be on a restricted Wi-Fi (school, office and public networks often block AI services, Google's especially). Other models answered instead; to use ${names.length > 1 ? "them" : "it"}, try another network, a phone hotspot or a VPN.`;
}

/** Tell FreeToken how a model's answer worked out (fire and forget): auto routing learns from it. */
export function reportModel(model: string | null, good: boolean, reason: string) {
  const token = cfg.token();
  if (!model || !token) return;
  fetch(`${cfg.url().replace(/\/+$/, "")}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ model, task: "agent", good, reason }),
  }).catch(() => { /* an older FreeToken without /feedback: nothing to learn from */ });
}

/** Have a vision model look at a screenshot of the page and list what's visibly wrong. */
export async function lookAtPage(jpeg: Buffer, request: string, signal?: AbortSignal): Promise<{ text: string; model?: string }> {
  try {
    const { data: r, response } = await client().chat.completions.create({
      model: "auto-smart",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `This is a screenshot of a page an AI agent just built for this request:\n"${request.slice(0, 800)}"\n\nAs a strict QA reviewer, list the concrete problems you can SEE: parts the request asks for that are missing, overlapping or misplaced elements, labels detached from what they label, unreadable text or low contrast, empty or broken areas (a stuck "Loading…", a blank canvas), content cut off. Say where each one is. If it looks right, reply "Looks right:" and one line on what's shown. At most 8 short bullets.` },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
        ],
      }],
    }, { signal, timeout: 90_000, maxRetries: 0 }).withResponse();
    const said = r.choices[0]?.message?.content?.trim();
    const who = response.headers.get("x-freetoken-provider") ?? undefined;
    return { text: said ? `\n\nWhat the page looks like (${who ?? "a vision model"} reviewed the screenshot):\n${said}` : "", model: who };
  } catch {
    return { text: "" }; // no vision model connected, or it's busy: the text and console above still count
  }
}

/** Which kind of model this step needs: "reasoning" to plan or get unstuck, else FreeToken's own guess. */
export function stepRole(s: { stuck?: boolean; bigJob?: boolean; planned?: boolean }, req: Pick<ChatRequest, "mode">, turn: number): "reasoning" | undefined {
  if (s.stuck) return "reasoning";
  if (req.mode === "plan") return "reasoning";
  if (s.bigJob && !s.planned && turn === 0) return "reasoning";
  return undefined;
}

export async function chatFreeToken(req: ChatRequest, emit: (e: AgentEvent) => void) {
  const s = getSession(req.sessionId); // shared: checkpoints, approvals, abort
  s.abort = new AbortController();
  s.seen.clear();
  s.idlePolls = 0;
  let msgs = transcripts.get(req.sessionId);
  if (!msgs) transcripts.set(req.sessionId, (msgs = []));
  startTurnState(s, req, msgs.filter((m) => m.role === "user" && typeof m.content === "string").slice(-3).map((m) => String(m.content).slice(-2000)).join("\n"));
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
    let stepModel: string | null = null, shownModel: string | null = null;
    const warnedUnreachable = new Set<string>();
    const turnModels = new Set<string>();
    for (let turn = 0; turn < (req.maxSteps ?? MAX_STEPS); turn++) {
      let text = "";
      let calls: { id: string; name: string; args: string }[] = [];
      let finish: string | null = null;
      let waits = 0, cutOff = false;
      const context = await contextFor(req.sessionId, msgs, userIndex, s.abort.signal, () => emit({ type: "text", delta: "\n\n*Summarising the earlier steps to keep the context small…*\n\n" }));
      for (let attempt = 0; ; attempt++) {
        text = ""; calls = []; finish = null;
        const nudge = attempt ? `\n\nIMPORTANT: call only these tools, by their exact names: ${tools.map((t) => t.type === "function" ? t.function.name : "").join(", ")}. No other tools exist (there is no repo_browser).` : "";
        const ask = system + nudge + (cutOff ? CUT_OFF : "");
        // thinking and typing go to different models: planning a big job, Plan mode and getting unstuck
        // ask FreeToken for its best reasoning model; ordinary steps for its best agent/coding model
        const role = stepRole(s, req, turn);
        try {
          const { data: stream, response } = await client().chat.completions.create({
            model: req.model || cfg.model() || "auto-smart",
            messages: [{ role: "system", content: ask }, ...context],
            tools,
            stream: true,
          }, { signal: s.abort.signal, maxRetries: 0, ...(role ? { headers: { "x-freetoken-task": role } } : {}) }).withResponse(); // retries happen below, visibly (rateLimitWait)
          // which model FreeToken picked: what it gets right or wrong is reported back so routing learns
          stepModel = response.headers.get("x-freetoken-provider");
          // providers the user's network couldn't reach: say so once per task (restricted Wi-Fi?)
          const unreachable = (response.headers.get("x-freetoken-unreachable") ?? "").split(",").map((p) => p.trim()).filter((p) => p && !warnedUnreachable.has(p));
          if (unreachable.length) {
            for (const p of unreachable) warnedUnreachable.add(p);
            emit({ type: "network_warning", providers: unreachable, message: unreachableMessage(unreachable) });
          }
          if (stepModel) turnModels.add(stepModel);
          // show the user which model works on this, and when FreeToken switches to another one
          if (stepModel && stepModel !== shownModel) {
            shownModel = stepModel;
            emit({ type: "model", model: stepModel, task: response.headers.get("x-freetoken-task") ?? undefined, fallbacks: response.headers.get("x-freetoken-fallbacks") ?? undefined });
          }
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
          if (role && s.stuck) s.stuck = false; // the reasoning model has had its step back
          break;
        } catch (e) {
          // free tiers rate-limit often and briefly: wait it out instead of failing the whole task
          const wait = rateLimitWait(e, waits);
          if (brokeOff(e)) cutOff = true;
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
      // the reply hit the output limit (a whole app in one write, or all the budget spent thinking):
      // drop it and ask again for a smaller step, instead of ending the task
      if (finish === "length" && (s.lengthRetries ?? 0) < 2) {
        s.lengthRetries = (s.lengthRetries ?? 0) + 1;
        reportModel(stepModel, false, "hit the output limit");
        msgs.push({ role: "user", content: "Your last reply hit the output limit before it finished, so it was discarded. Work in smaller steps: think briefly, then make one change per tool call — write a big file as a skeleton first and add each section with edit_file (under ~250 lines per call)." });
        emit({ type: "text", delta: "\n\n*That reply was too long — continuing in smaller steps…*\n\n" });
        continue;
      }
      // an empty reply (no text, no tool calls) isn't recorded: providers reject a transcript containing
      // one ("must have non-empty content or tool calls") on every later request
      if (text || uses.length) msgs.push({
        role: "assistant",
        content: text || null,
        ...(uses.length ? { tool_calls: uses.map((u) => ({ id: u.id, type: "function" as const, function: { name: u.name, arguments: u.args || "{}" } })) } : {}),
      });
      if (!uses.length) {
        const gate = await regressionGate(s, emit);
        if (gate) { msgs.push({ role: "user", content: gate }); continue; }
        const nudge = buildNudge(s, text, req.text);
        if (nudge) {
          if (nudge.kind === "false-claim" || nudge.kind === "code-dump") reportModel(stepModel, false, nudge.kind);
          msgs.push({ role: "user", content: nudge.prompt }); if (nudge.label) emit({ type: "text", delta: `\n\n${nudge.label}\n\n` }); continue;
        }
        // a task that changed the project and ended cleanly counts for every model that worked on it
        if (s.turns[s.turns.length - 1]?.files.size && !s.unchecked) for (const m of turnModels) reportModel(m, true, "finished a task");
        return emit({ type: "done", stopReason: finish ?? "stop" });
      }
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
          reportModel(stepModel, false, "unknown tool");
        } else if (!parsed?.success) {
          content = `Invalid arguments for ${u.name}: ${parsed ? parsed.error.issues.map((i) => i.message).join("; ") : "not valid JSON"}. Retry with valid JSON matching the schema.`;
          emit({ type: "tool_end", id: u.id, ok: false, summary: "Invalid tool call" });
          reportModel(stepModel, false, "invalid tool call");
        } else {
          try {
            const r = await execTool(s, u.name as ToolName, parsed.data, emit, u.id);
            content = r.content;
            // the agent model may not see images: a vision model looks at the page and describes problems
            if (u.name === "inspect_preview" && r.image) {
              const look = await lookAtPage(r.image, req.text, s.abort.signal);
              if (look.text) { content += look.text; r.summary += ` · screenshot reviewed${look.model ? ` by ${look.model.split("/").pop()}` : ""}`; }
            }
            emit({ type: "tool_end", id: u.id, ok: true, summary: r.summary, detail: toolDetail(u.name, r) });
          } catch (e) {
            content = `Error: ${(e as Error).message}`;
            emit({ type: "tool_end", id: u.id, ok: false, summary: (e as Error).message });
          }
        }
        msgs.push({ role: "tool", tool_call_id: u.id, content });
      }
      const budget = stepsLeftNote(turn);
      if (budget) msgs.push({ role: "user", content: budget });
      if (s.abort.signal.aborted) return emit({ type: "done", stopReason: "aborted" });
    }
    emit({ type: "error", message: `Stopped after ${MAX_STEPS} steps.` });
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
    // attachments are big: later turns keep a note with the saved path instead of pictures and file
    // contents (sending a 40k-token floor plan with every message made each turn slow and costly)
    if ((att.images.length || att.texts.length) && msgs[userIndex]?.role === "user") {
      let light = userText;
      for (const t of att.texts) light = light.replace(t, `${t.split("\n")[0].replace(/:$/, "")} — contents were shown in this turn; read_file it again if you need them.`);
      if (att.images.length) light += `\n\n(${att.images.length} image${att.images.length > 1 ? "s were" : " was"} shown with this message; the files are in .v-run/uploads.)`;
      msgs[userIndex] = { role: "user", content: light };
    }
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
