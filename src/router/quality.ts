// Task-aware model choice for auto-smart / auto-fast: what kind of request is this, and how good is each
// free model at that kind of task? The best model with quota left goes first; weaker ones only take
// over once the strong ones are used up, rate-limited or failing.
//
// The scores are starting estimates (0–100) from public benchmarks and how these models behave as
// agents; edit them freely — the router only cares about their order.

export type Task = 'agent' | 'code' | 'reasoning' | 'vision' | 'creative' | 'chat';
type Scores = Partial<Record<Task, number>> & { base: number };

/** First matching pattern wins (patterns test "provider/modelId"). */
const QUALITY: [RegExp, Scores][] = [
  [/nemotron-3-ultra-550b/, { base: 88, agent: 88, code: 86, reasoning: 91, creative: 84 }],
  [/qwen3\.8|qwen3-coder|qwen.*coder/, { base: 84, agent: 89, code: 91, reasoning: 84, creative: 76 }],
  [/deepseek-v4|deepseek-r|deepseek-v3/i, { base: 86, agent: 85, code: 88, reasoning: 90, creative: 80 }],
  [/glm-4\.7|glm-5/, { base: 84, agent: 89, code: 87, reasoning: 83, creative: 80 }],
  [/gpt-oss-120b/, { base: 84, agent: 85, code: 84, reasoning: 89, creative: 78 }],
  [/gemini-3\.8-flash|gemini-3(\.\d)?-flash(?!-lite)/, { base: 86, agent: 80, code: 85, reasoning: 86, vision: 92, creative: 86 }],
  [/nemotron-3-super-120b/, { base: 80, agent: 80, code: 80, reasoning: 85, creative: 78 }],
  [/kilo-auto/, { base: 78, agent: 78, code: 78, reasoning: 78 }],
  [/gpt-4\.1-mini/, { base: 79, agent: 78, code: 79, reasoning: 77, vision: 80, creative: 82 }],
  [/command-a/, { base: 72, agent: 68, code: 70, reasoning: 72, creative: 80 }],
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
  return hit[task] ?? hit.base;
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
export function learnedAdjustment(s: { ok: number; errors: number; good: number; bad: number }) {
  const runs = s.ok + s.errors;
  const reliability = runs >= 5 ? (s.ok / runs - 0.9) * 40 * Math.min(1, runs / 30) : 0; // 50% ok → −16
  const votes = s.good + s.bad;
  const verdict = votes ? ((s.good - s.bad) / votes) * 10 * Math.min(1, votes / 6) : 0;
  return Math.round(Math.max(-20, Math.min(10, reliability + verdict)) * 10) / 10;
}
