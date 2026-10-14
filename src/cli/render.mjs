// Lightweight Markdown → ANSI renderer for the terminal, so assistant replies look polished
// (bold, headings, bullets, inline code, fenced code blocks). Pure and testable; pass
// { color:false } to get clean plain text with the syntax stripped.

const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[38;5;39m',
  yellow: '\x1b[33m',
  boldBlue: '\x1b[1m\x1b[38;5;39m',
};

const paint = (color, code, s) => (color ? code + s + A.reset : s);

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|async|await|def|public|private|void|null|true|false|def|end)\b/g;

// Very light syntax coloring for a code line: strings, comments, numbers, keywords.
function highlightCode(line, color) {
  if (!color) return '  │ ' + line;
  let l = line;
  l = l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (m) => A.yellow + m + A.reset); // strings
  l = l.replace(/(^|\s)(\/\/.*|#.*)$/g, (_m, pre, c) => pre + A.dim + c + A.reset); // trailing comments
  l = l.replace(/\b(\d+(?:\.\d+)?)\b/g, (m) => A.cyan + m + A.reset); // numbers
  l = l.replace(KEYWORDS, (m) => A.blue + m + A.reset); // keywords
  return paint(color, A.dim, '  │ ') + l;
}

export function renderMarkdown(text, { color = true } = {}) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; } // skip the ``` fence markers
    if (inFence) { out.push(highlightCode(line, color)); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { out.push(paint(color, A.boldBlue, heading[2])); continue; }

    let l = line.replace(/^(\s*)[-*+]\s+/, (_m, s) => s + paint(color, A.blue, '• '));
    l = l.replace(/`([^`]+)`/g, (_m, code) => paint(color, A.cyan, code));
    l = l.replace(/\*\*([^*]+)\*\*/g, (_m, b) => paint(color, A.bold, b));
    out.push(l);
  }

  return out.join('\n');
}
