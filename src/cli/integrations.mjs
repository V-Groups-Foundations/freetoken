// Use FreeToken from the AI tools people already have. `freetoken run <command>` starts any command
// with the environment pointed at FreeToken — Anthropic-style clients (Claude Code, Anthropic SDKs) at
// /api/v1/messages and OpenAI-style ones (Aider, OpenAI SDKs, many CLIs) at /api/v1 — without touching
// their global settings. `freetoken setup <tool>` prints copy-paste setup for tools configured in an app.

/** The origin of a FreeToken base URL (…/api/v1). */
export const originOf = (baseUrl) => new URL(baseUrl).origin;

/** Environment that points both Anthropic- and OpenAI-style clients at FreeToken. */
export function envFor(baseUrl, token, model = 'auto-smart') {
  const origin = originOf(baseUrl);
  return {
    // Claude Code / Anthropic SDKs: base + /v1/messages; the ft_ token is sent as a bearer
    ANTHROPIC_BASE_URL: `${origin}/api`,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_API_KEY: '', // otherwise a real Anthropic key would take precedence
    // OpenAI SDKs and the many tools built on them
    OPENAI_BASE_URL: `${origin}/api/v1`,
    OPENAI_API_BASE: `${origin}/api/v1`,
    OPENAI_API_KEY: token,
    // for tools configured with a custom provider (Codex, OpenCode, …)
    FREETOKEN_API_KEY: token,
    FREETOKEN_MODEL: model,
  };
}

const WIN = typeof process !== 'undefined' && process.platform === 'win32';

/** Quote one argument for a Windows command line (CommandLineToArgvW rules; safe inside cmd /c "…"). */
export function quoteWinArg(a) {
  if (a !== '' && !/[\s"&|<>^%()]/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
}

/**
 * How to start `cmd args…` so arguments with spaces survive. On Windows a real .exe is started directly;
 * .cmd/.bat shims (npm-installed tools) need the shell, so the line is quoted for it.
 */
export function launchPlan(cmd, args, which = () => []) {
  if (!WIN) return { file: cmd, args, shell: false };
  const found = which(cmd);
  const exe = found.find((p) => /\.exe$/i.test(p));
  if (exe) return { file: exe, args, shell: false };
  return { file: [cmd, ...args].map(quoteWinArg).join(' '), args: [], shell: true };
}

/** Copy-paste setup per tool. {base} = …/api/v1, {origin} = http://host:port, {token} = a hint, not a secret. */
export const GUIDES = {
  'claude-code': {
    name: 'Claude Code',
    steps: [
      'Easiest — run it through FreeToken (nothing else changes):',
      '  freetoken run claude            (or, in the FreeToken folder: npm run claude)',
      'Or set it for your shell:',
      WIN ? '  $env:ANTHROPIC_BASE_URL="{origin}/api"; $env:ANTHROPIC_AUTH_TOKEN="{token}"; claude'
        : '  ANTHROPIC_BASE_URL={origin}/api ANTHROPIC_AUTH_TOKEN={token} claude',
      'Claude model names map to FreeToken: haiku → auto-fast, everything else → auto-smart.',
    ],
  },
  codex: {
    name: 'OpenAI Codex CLI',
    steps: [
      'Add to ~/.codex/config.toml:',
      '  [model_providers.freetoken]',
      '  name = "FreeToken"',
      '  base_url = "{base}"',
      '  env_key = "FREETOKEN_API_KEY"',
      '  wire_api = "chat"',
      'then: freetoken run codex -c model_provider=freetoken -m auto-smart',
      '(Needs a Codex version that still supports wire_api = "chat".)',
    ],
  },
  cursor: {
    name: 'Cursor',
    steps: ['Settings → Models → OpenAI API Key: paste {token}', 'Override OpenAI Base URL: {base}', 'Add a custom model named auto-smart and select it.'],
  },
  cline: {
    name: 'Cline / Roo Code',
    steps: ['API Provider: OpenAI Compatible', 'Base URL: {base}', 'API Key: {token}', 'Model ID: auto-smart'],
  },
  continue: {
    name: 'Continue',
    steps: ['In config.yaml under models:', '  - name: FreeToken', '    provider: openai', '    model: auto-smart', '    apiBase: {base}', '    apiKey: {token}'],
  },
  aider: {
    name: 'Aider',
    steps: ['freetoken run aider --model openai/auto-smart'],
  },
  opencode: {
    name: 'OpenCode',
    steps: ['freetoken run opencode   — then pick the OpenAI-compatible provider; base URL and key come from the environment ({base}).'],
  },
};

/** The text `freetoken setup <tool>` prints (all tools when `tool` is empty). */
export function setupText(tool, baseUrl, tokenHint = '<your ft_ token>') {
  const base = baseUrl.replace(/\/+$/, '');
  const fill = (s) => s.replaceAll('{base}', base).replaceAll('{origin}', originOf(base)).replaceAll('{token}', tokenHint);
  const keys = tool ? [tool] : Object.keys(GUIDES);
  const unknown = keys.filter((k) => !GUIDES[k]);
  if (unknown.length) return `Unknown tool "${unknown[0]}". Try: ${Object.keys(GUIDES).join(', ')}`;
  return keys.map((k) => `${GUIDES[k].name}\n${GUIDES[k].steps.map((s) => `  ${fill(s)}`).join('\n')}`).join('\n\n');
}
