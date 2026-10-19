// Line diff for the chat's edit cards: common prefix/suffix trimmed, LCS on the middle, then cut into hunks.
export type DiffLine = { t: " " | "+" | "-"; s: string; a?: number; b?: number };
export type ToolDetail =
  | { kind: "diff"; path: string; added: number; removed: number; created?: boolean; lines: DiffLine[] }
  | { kind: "output"; text: string; lines: number };

const MAX_CELLS = 4_000_000; // LCS table budget; bigger changes fall back to "replace the middle"
const MAX_LINES = 400; // lines sent to the renderer per card

export function lineDiff(before: string, after: string, context = 3): { added: number; removed: number; lines: DiffLine[] } {
  const A = before === "" ? [] : before.split("\n"), B = after === "" ? [] : after.split("\n");
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let q = 0;
  while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
  const a = A.slice(p, A.length - q), b = B.slice(p, B.length - q);
  const ops: DiffLine[] = [];
  for (let i = 0; i < p; i++) ops.push({ t: " ", s: A[i], a: i + 1, b: i + 1 });
  if (a.length * b.length <= MAX_CELLS) {
    // dp[i][j] = LCS length of a[i..] and b[j..]
    const n = a.length, m = b.length, w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push({ t: " ", s: a[i], a: p + i + 1, b: p + j + 1 }); i++; j++; }
      else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) { ops.push({ t: "+", s: b[j], b: p + j + 1 }); j++; }
      else { ops.push({ t: "-", s: a[i], a: p + i + 1 }); i++; }
    }
  } else {
    a.forEach((s, i) => ops.push({ t: "-", s, a: p + i + 1 }));
    b.forEach((s, j) => ops.push({ t: "+", s, b: p + j + 1 }));
  }
  for (let k = 0; k < q; k++) ops.push({ t: " ", s: A[A.length - q + k], a: A.length - q + k + 1, b: B.length - q + k + 1 });

  const added = ops.filter((o) => o.t === "+").length, removed = ops.filter((o) => o.t === "-").length;
  // keep changed lines plus `context` lines around them; a gap becomes a "…" marker line
  const keep = ops.map(() => false);
  ops.forEach((o, k) => { if (o.t !== " ") for (let d = -context; d <= context; d++) if (ops[k + d]) keep[k + d] = true; });
  const lines: DiffLine[] = [];
  ops.forEach((o, k) => {
    if (keep[k]) lines.push(o);
    else if (keep[k - 1] && lines.length) lines.push({ t: " ", s: "…" });
  });
  return { added, removed, lines: lines.slice(0, MAX_LINES) };
}

export function diffDetail(path: string, before: string, after: string, created = false): ToolDetail {
  return { kind: "diff", path, created, ...lineDiff(before.replace(/\r\n/g, "\n"), after.replace(/\r\n/g, "\n")) };
}

export function outputDetail(text: string, max = 6000): ToolDetail {
  const t = text.length > max ? `${text.slice(0, max)}\n…` : text;
  return { kind: "output", text: t, lines: text.split("\n").length };
}
