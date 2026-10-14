// Lightweight Markdown → ANSI renderer for the terminal, so assistant replies look polished
// (bold, headings, bullets, inline code, fenced code blocks). Pure and testable; pass
// { color:false } to get clean plain text with the syntax stripped.

const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  boldCyan: '\x1b[1m\x1b[36m',
};

const paint = (color, code, s) => (color ? code + s + A.reset : s);

export function renderMarkdown(text, { color = true } = {}) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; } // skip the ``` fence markers
    if (inFence) { out.push(paint(color, A.dim, '  │ ' + line)); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { out.push(paint(color, A.boldCyan, heading[2])); continue; }

    let l = line.replace(/^(\s*)[-*+]\s+/, (_m, s) => s + paint(color, A.green, '• '));
    l = l.replace(/`([^`]+)`/g, (_m, code) => paint(color, A.cyan, code));
    l = l.replace(/\*\*([^*]+)\*\*/g, (_m, b) => paint(color, A.bold, b));
    out.push(l);
  }

  return out.join('\n');
}
