import { describe, it, expect } from 'vitest';
import { lineDiff, diffStat, renderDiff } from '../../src/cli/diff.mjs';

describe('lineDiff', () => {
  it('marks added, removed, and unchanged lines', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc');
    expect(d).toEqual([
      { type: ' ', text: 'a' },
      { type: '-', text: 'b' },
      { type: '+', text: 'B' },
      { type: ' ', text: 'c' },
    ]);
  });
  it('counts a stat', () => {
    expect(diffStat(lineDiff('a\nb', 'a\nb\nc'))).toEqual({ added: 1, removed: 0 });
  });
});

describe('renderDiff (plain)', () => {
  it('prefixes changes with +/-', () => {
    const out = renderDiff(lineDiff('x', 'y'), { color: false });
    expect(out).toContain('- x');
    expect(out).toContain('+ y');
  });
});
