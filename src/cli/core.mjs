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

/** Parse argv (without node/script) into { command, model, project, message }. */
export function parseArgs(argv) {
  if (argv[0] === 'login') return { command: 'login', model: null, project: null, message: null };
  let model = null;
  let project = null;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--model' || argv[i] === '-m') && argv[i + 1]) {
      model = argv[++i];
    } else if ((argv[i] === '--project' || argv[i] === '-p') && argv[i + 1]) {
      project = argv[++i];
    } else {
      words.push(argv[i]);
    }
  }
  return { command: 'chat', model, project, message: words.length ? words.join(' ') : null };
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
    default:
      return { type: 'error', message: `Unknown command ${cmd}. Try /help.` };
  }
}
