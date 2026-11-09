// Task-aware model choice for auto-smart / auto-fast: what kind of request is this, and how good is each
// free model at that kind of task? The best model with quota left goes first; weaker ones only take
// over once the strong ones are used up, rate-limited or failing.
//
// The scores are starting estimates (0–100) from public benchmarks and how these models behave as
// agents; edit them freely — the router only cares about their order.

// A coding agent's steps go to three roles (V-Run names its role in x-freetoken-task): "reasoning" plans
// and gets unstuck, "agent" does the work, "review" checks the finished changes for a second opinion.
// The scores for those roles come from sandbox tests (a 7-file project with 5 planted bugs, run through
// V-Run, graded by hidden tests, 2026-10-30):
//   planner + reviewer: gpt-oss-120b found all 5 in every round (3/3) with no false alarms, in ~4s on
//     Groq; Nemotron Ultra found 2–3 and timed out planning; Command-A Reasoning/Plus found 1–4 and
//     flagged things that weren't wrong
//   worker: Nemotron Ultra fixed all 5 (8/8 hidden checks, 6 min), Nemotron Super 7/8; Command-A and
//     Command-A Reasoning stopped early with 2–3/8; Cloudflare's gpt-oss-120b streamed "!!!!…" as an agent
export type Task = 'agent' | 'code' | 'reasoning' | 'review' | 'vision' | 'creative' | 'chat';
export const TASKS: readonly Task[] = ['agent', 'code', 'reasoning', 'review', 'vision', 'creative', 'chat'];
/** A task kind the client asked for (the x-freetoken-task request header), if it's a known one. */
export const parseTask = (v: string | null | undefined): Task | undefined => (TASKS as readonly string[]).includes(v ?? '') ? (v as Task) : undefined;
type Scores = Partial<Record<Task, number>> & { base: number };

/** First matching pattern wins (patterns test "provider/modelId"). */
const QUALITY: [RegExp, Scores][] = [
  [/nemotron-3-ultra-550b/, { base: 88, agent: 93, code: 86, reasoning: 85, review: 80, creative: 84 }],
  [/qwen3\.8|qwen3-coder|qwen.*coder/, { base: 84, agent: 86, code: 91, reasoning: 84, creative: 76 }],
  [/deepseek-v4|deepseek-r|deepseek-v3/i, { base: 86, agent: 85, code: 88, reasoning: 88, creative: 80 }],
  [/glm-4\.7|glm-5/, { base: 84, agent: 86, code: 87, reasoning: 83, creative: 80 }],
  [/^cloudflare\/.*gpt-oss-120b/, { base: 84, agent: 70, code: 84, reasoning: 93, review: 94, creative: 78 }],
  [/gpt-oss-120b/, { base: 84, agent: 85, code: 84, reasoning: 94, review: 95, creative: 78 }],
  [/gemini-3\.8-flash|gemini-3(\.\d)?-flash(?!-lite)/, { base: 86, agent: 80, code: 85, reasoning: 86, vision: 92, creative: 86 }],
  [/nemotron-3-super-120b/, { base: 80, agent: 80, code: 80, reasoning: 85, creative: 78 }],
  [/nemotron-3\.5-super-vl/, { base: 81, agent: 80, code: 79, reasoning: 83, vision: 86, creative: 76 }],
  [/command-a-vision/, { base: 76, vision: 90, creative: 74 }],
  [/command-a-reasoning/, { base: 80, agent: 66, code: 78, reasoning: 80, review: 70, creative: 76 }],
  [/command-a-plus/, { base: 80, agent: 74, code: 79, reasoning: 78, review: 68, creative: 82 }],
  [/kilo-auto/, { base: 78, agent: 78, code: 78, reasoning: 78 }],
  [/gpt-4\.1-mini/, { base: 79, agent: 78, code: 79, reasoning: 77, vision: 80, creative: 82 }],
  [/command-a/, { base: 72, agent: 60, code: 70, reasoning: 72, creative: 80 }],
  [/codestral/, { base: 70, agent: 72, code: 82, reasoning: 66, creative: 60 }],
  [/llama-3\.3-70b|Llama-3\.3-70B/i, { base: 72, agent: 66, code: 70, reasoning: 72, creative: 78 }],
  [/gemma-4-31b/, { base: 74, agent: 68, code: 72, reasoning: 74, vision: 78, creative: 78 }],
  [/glm-4\.5-flash/, { base: 72, agent: 74, code: 72, reasoning: 70 }],
  [/gpt-oss-20b|openai-fast|starter\/openai$/, { base: 70, agent: 72, code: 72, reasoning: 76, creative: 66 }],
  [/nemotron-3\.5-lightning/, { base: 68, agent: 68, code: 68, reasoning: 70, creative: 66 }],
  [/gemini-3\.5-flash-lite|flash-lite/, { base: 70, agent: 66, code: 70, reasoning: 70, vision: 82, creative: 72 }],
  [/gpt-4\.1-nano/, { base: 64, agent: 62, code: 64, reasoning: 62, vision: 70 }],
  [/command-r7b|Llama-3\.1-8B/i, { base: 56, agent: 50, code: 54, reasoning: 54, creative: 60 }],
];

export function quality(provider: string, modelId: string, task: Task): number {
  const key = `${provider}/${modelId}`;
  const hit = QUALITY.find(([re]) => re.test(key))?.[1];
  if (!hit) return 60;
  // reviewing is reasoning about code: a model not measured as a reviewer goes by its reasoning score
  return hit[task] ?? (task === 'review' ? hit.reasoning : undefined) ?? hit.base;
}

type Msg = { role?: string; content?: unknown };
const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text ?? '') : '')).join(' ') : '';
const hasImage = (msgs: Msg[]) => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p && typeof p === 'object' && (p as { type?: string }).type === 'image_url'));
const EDIT_TOOLS = /^(write_file|edit_file|apply_patch|exec_command|run_terminal_command|shell|str_replace|create_file|Write|Edit|Bash)$/;

/** What kind of request is this? (Looks at the tools offered and the latest user message.) */
export function detectTask(body: { messages?: unknown; tools?: unknown }): Task {
  const msgs = (Array.isArray(body.messages) ? body.messages : []) as Msg[];
  if (hasImage(msgs.slice(-4))) return 'vision';
  const tools = Array.isArray(body.tools) ? (body.tools as { function?: { name?: string }; name?: string }[]) : [];
  // a coding agent (V-Run, Claude Code, Codex, Cline…) offers file-editing / shell tools
  if (tools.some((t) => EDIT_TOOLS.test(t.function?.name ?? t.name ?? ''))) return 'agent';
  const last = [...msgs].reverse().find((m) => m.role === 'user');
  const text = textOf(last?.content).slice(-4000).toLowerCase();
  if (/```|\b(function|class|const|import|def|return|npm|python|javascript|typescript|react|html|css|sql|api|bug|error|stack ?trace|compile|refactor|regex|script)\b/.test(text)) return 'code';
  if (/\b(prove|proof|calculate|solve|equation|math|logic|puzzle|reason|step by step|probability|optimi[sz]e|algorithm|plan|strategy|compare|why does|analy[sz]e)\b|\d+\s*[+\-*/^]\s*\d+/.test(text)) return 'reasoning';
  if (/\b(write|story|poem|essay|blog|email|caption|slogan|rewrite|tone|marketing|lyrics|script for)\b/.test(text)) return 'creative';
  return 'chat';
}

/**
 * Learning from real results: a model that often fails this kind of request, or whose answers clients
 * report as bad (broken tool calls, claims of work it didn't do), drops below the estimate; one that
 * keeps delivering rises a little. Little history → little change, so one bad day can't bury a model.
 */
export function learnedAdjustment(s: { ok: number; errors: number; good: number; bad: number; benchPassed?: number; benchTotal?: number }) {
  const runs = s.ok + s.errors;
  const reliability = runs >= 5 ? (s.ok / runs - 0.9) * 40 * Math.min(1, runs / 30) : 0; // 50% ok → −16
  const votes = s.good + s.bad;
  const verdict = votes ? ((s.good - s.bad) / votes) * 10 * Math.min(1, votes / 6) : 0;
  // benchmark runs are real tasks graded by running the result — the strongest evidence there is, so
  // they move a model most: all passed → +12, three in four → 0, half → −12 (at full weight, 8+ runs)
  const total = s.benchTotal ?? 0;
  const bench = total >= 3 ? ((s.benchPassed ?? 0) / total - 0.75) * 48 * Math.min(1, total / 8) : 0;
  // everyday evidence alone stays within −20…+10; benchmark results move a model further either way
  const everyday = Math.max(-20, Math.min(10, reliability + verdict));
  return Math.round(Math.max(-30, Math.min(16, everyday + bench)) * 10) / 10;
}
