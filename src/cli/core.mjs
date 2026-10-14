// Pure, testable helpers for the FreeToken CLI. No Node side effects here.

/** Merge config-file values with env overrides into { baseUrl, token }. */
export function resolveConfig(fileData, env = {}) {
  const file = fileData ?? {};
  let baseUrl = env.FREETOKEN_BASE_URL || file.baseUrl || null;
  const token = env.FREETOKEN_TOKEN || file.token || null;
  if (baseUrl) baseUrl = baseUrl.replace(/\/+$/, '');
  return { baseUrl, token };
}

/**
 * Interpret one SSE line from /chat/completions.
 * @returns {{content:string}|{done:true}|null}
 */
export function deltaFromLine(line) {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data) return null;
  if (data === '[DONE]') return { done: true };
  try {
    const content = JSON.parse(data).choices?.[0]?.delta?.content;
    return typeof content === 'string' && content.length ? { content } : null;
  } catch {
    return null;
  }
}

/** Parse argv (without node/script) into { command, model, project, message, auto }. */
export function parseArgs(argv) {
  if (argv[0] === 'login') return { command: 'login', model: null, project: null, message: null, auto: false };
  let model = null;
  let project = null;
  let auto = false;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--model' || argv[i] === '-m') && argv[i + 1]) {
      model = argv[++i];
    } else if ((argv[i] === '--project' || argv[i] === '-p') && argv[i + 1]) {
      project = argv[++i];
    } else if (argv[i] === '--yolo' || argv[i] === '--auto') {
      auto = true;
    } else {
      words.push(argv[i]);
    }
  }
  return { command: 'chat', model, project, message: words.length ? words.join(' ') : null, auto };
}

/**
 * Strip internal bookkeeping (e.g. `provider`) so only OpenAI-standard fields reach the API.
 * Providers reject unknown properties on message objects, so every request body must be sanitized.
 */
export function toApiMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      // Whitelist standard fields only. Providers reject unknown properties when a message is
      // echoed back — our `provider`, NVIDIA's `reasoning_content`, etc. `tool_calls` is kept
      // wholesale so anything a provider nests inside a call (e.g. Gemini's signature) survives.
      const out = { role: 'assistant' };
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) out.tool_calls = m.tool_calls;
      if (typeof m.content === 'string' && m.content) out.content = m.content;
      if (!('content' in out) && !('tool_calls' in out)) out.content = '';
      return out;
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id, content: String(m.content ?? '') };
    }
    return { role: m.role, content: String(m.content ?? '') };
  });
}

/** Make a string safe to use as a folder name across OSes. */
export function sanitizeFolderName(name) {
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .trim();
  return cleaned || 'project';
}

/** Render a project's conversation as a Markdown transcript saved beside the project folder. */
export function renderTranscript(projectName, messages) {
  const lines = [`# ${projectName}`, '', '_FreeToken project transcript — shared with the web app._', ''];
  for (const m of messages) {
    const who = m.role === 'user' ? 'You' : (m.provider ?? 'assistant');
    lines.push(`**${who}:** ${m.content}`, '');
  }
  return lines.join('\n');
}

/** Decide what a REPL input means. Returns a tagged action. */
export function applyCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { type: 'message', text: trimmed };
  const [cmd, ...rest] = trimmed.split(/\s+/);
  switch (cmd) {
    case '/clear':
      return { type: 'clear' };
    case '/exit':
    case '/quit':
      return { type: 'exit' };
    case '/help':
      return { type: 'help' };
    case '/models':
      return { type: 'models' };
    case '/model':
      return rest.length ? { type: 'model', model: rest.join(' ') } : { type: 'error', message: 'Usage: /model <id>' };
    case '/project':
      return { type: 'project', project: rest.length ? rest.join(' ') : null };
    case '/agent':
      return { type: 'mode', mode: 'agent' };
    case '/chat':
      return { type: 'mode', mode: 'chat' };
    case '/mode': {
      const m = rest[0];
      if (m === 'agent' || m === 'chat') return { type: 'mode', mode: m };
      return { type: 'error', message: 'Usage: /mode <agent|chat>' };
    }
    default:
      return { type: 'error', message: `Unknown command ${cmd}. Try /help.` };
  }
}
