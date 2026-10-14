import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/cli/render.mjs';

describe('renderMarkdown (color off = clean plain text)', () => {
  const plain = (s) => renderMarkdown(s, { color: false });

  it('turns headings into their text', () => {
    expect(plain('# Title')).toBe('Title');
    expect(plain('### Sub')).toBe('Sub');
  });
  it('turns list markers into bullets', () => {
    expect(plain('- one\n* two\n+ three')).toBe('• one\n• two\n• three');
  });
  it('unwraps bold and inline code', () => {
    expect(plain('a **bold** and `code` here')).toBe('a bold and code here');
  });
  it('renders fenced code blocks with a gutter and drops the fences', () => {
    expect(plain('```js\nconst x = 1;\n```')).toBe('  │ const x = 1;');
  });
  it('is a no-op on empty input', () => {
    expect(plain('')).toBe('');
  });
});

describe('renderMarkdown (color on adds ANSI)', () => {
  it('wraps bold text in escape codes', () => {
    const out = renderMarkdown('**hi**', { color: true });
    expect(out).toContain('\x1b[1m');
    expect(out).toContain('hi');
  });
});
