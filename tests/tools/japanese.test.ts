import { describe, it, expect } from 'vitest';
import { looksJapanese } from '@/tools/japanese';

describe('looksJapanese', () => {
  it('detects hiragana and katakana', () => {
    expect(looksJapanese('こんにちは')).toBe(true);
    expect(looksJapanese('コンニチハ')).toBe(true);
    expect(looksJapanese('東京に行きます')).toBe(true); // kanji + kana
  });
  it('does not fire on English or pure-kanji Chinese', () => {
    expect(looksJapanese('hello world')).toBe(false);
    expect(looksJapanese('我爱编程')).toBe(false); // Chinese, no kana
  });
});
