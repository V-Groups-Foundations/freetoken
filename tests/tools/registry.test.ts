import { describe, it, expect } from 'vitest';
import { TOOLS, getTool, buildToolMessages } from '@/tools/registry';

describe('tools registry', () => {
  it('exposes the four tools with unique ids', () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual(['classify', 'extract', 'summarize', 'translate']);
  });

  it('builds system+user messages and folds the option into the system prompt', () => {
    const translate = getTool('translate')!;
    const msgs = buildToolMessages(translate, 'Hello', 'French');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('French');
    expect(msgs[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('extract and classify request JSON output', () => {
    expect(getTool('extract')!.jsonMode).toBe(true);
    expect(getTool('classify')!.jsonMode).toBe(true);
    expect(getTool('summarize')!.jsonMode).toBe(false);
  });

  it('classify embeds the category list', () => {
    const sys = getTool('classify')!.system('a, b, c');
    expect(sys).toContain('a, b, c');
    expect(sys).toContain('category');
  });

  it('returns undefined for an unknown tool', () => {
    expect(getTool('nope')).toBeUndefined();
  });

  it('gives the extractor one-click presets that fill the option', () => {
    const extract = getTool('extract')!;
    expect(extract.presets?.length).toBeGreaterThan(2);
    const contact = extract.presets?.find((p) => p.label === 'Contact info');
    expect(contact?.value).toContain('email');
  });
});
