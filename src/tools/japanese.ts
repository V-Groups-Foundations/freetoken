// Detect Japanese text. Kana (hiragana/katakana) are unique to Japanese, so we key on them:
// kanji alone (一-龯) also appears in Chinese and would cause false positives.
const KANA = /[぀-ゟ゠-ヿｦ-ﾝ]/;

export function looksJapanese(text: string): boolean {
  return KANA.test(text);
}
