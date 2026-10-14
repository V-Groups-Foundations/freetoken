// Minimal line-based diff (LCS) + ANSI renderer, for showing edits before/after a write.

export function lineDiff(oldStr, newStr) {
  const a = String(oldStr ?? '').split('\n');
  const b = String(newStr ?? '').split('\n');
  const m = a.length;
  const n = b.length;
  // LCS length table.
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: ' ', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: '-', text: a[i] }); i++; }
    else { out.push({ type: '+', text: b[j] }); j++; }
  }
  while (i < m) out.push({ type: '-', text: a[i++] });
  while (j < n) out.push({ type: '+', text: b[j++] });
  return out;
}

export function diffStat(diff) {
  let added = 0;
  let removed = 0;
  for (const d of diff) {
    if (d.type === '+') added++;
    else if (d.type === '-') removed++;
  }
  return { added, removed };
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** Render a diff with +/- lines, collapsing long unchanged runs. */
export function renderDiff(diff, { color = true, maxLines = 80, contextRuns = true } = {}) {
  const lines = [];
  let unchangedRun = [];

  const flushUnchanged = () => {
    if (!unchangedRun.length) return;
    if (contextRuns && unchangedRun.length > 4) {
      lines.push(paint(color, DIM, `    ${unchangedRun[0]}`));
      lines.push(paint(color, DIM, `    … ${unchangedRun.length - 2} unchanged lines …`));
      lines.push(paint(color, DIM, `    ${unchangedRun[unchangedRun.length - 1]}`));
    } else {
      for (const t of unchangedRun) lines.push(paint(color, DIM, `    ${t}`));
    }
    unchangedRun = [];
  };

  for (const d of diff) {
    if (d.type === ' ') { unchangedRun.push(d.text); continue; }
    flushUnchanged();
    if (d.type === '+') lines.push(paint(color, GREEN, `  + ${d.text}`));
    else lines.push(paint(color, RED, `  - ${d.text}`));
  }
  flushUnchanged();

  if (lines.length > maxLines) {
    const extra = lines.length - maxLines;
    return lines.slice(0, maxLines).join('\n') + '\n' + paint(color, DIM, `    … +${extra} more diff lines`);
  }
  return lines.join('\n');
}

function paint(color, code, s) {
  return color ? code + s + RESET : s;
}
