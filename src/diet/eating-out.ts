// "I'm going to Hama Sushi — what should I eat?": the coach guessed menu numbers (salmon nigiri at 46 kcal
// in one answer, 97 in the next). Now a message that names where they're eating searches that place's menu
// nutrition first, and the coach plans from what the web says. The results are kept for a few hours, so the
// follow-ups at the same place ("okay 4 tuna nigiri") use them too.
import type { KV } from '@/lib/kv';
import type { SearchResult } from '@/web/search';

/** Chains people eat at in Japan (and a few everywhere), as people type them. */
const CHAINS: [RegExp, string][] = [
  [/hama\s*-?\s*sushi|はま寿司/i, 'Hama Sushi はま寿司'],
  [/sushiro|スシロー/i, 'Sushiro スシロー'],
  [/kura\s*(sushi)?\b|くら寿司/i, 'Kura Sushi くら寿司'],
  [/kappa\s*sushi|かっぱ寿司/i, 'Kappa Sushi かっぱ寿司'],
  [/sukiya|すき家/i, 'Sukiya すき家'],
  [/yoshinoya|吉野家/i, 'Yoshinoya 吉野家'],
  [/matsuya|松屋/i, 'Matsuya 松屋'],
  [/ootoya|大戸屋/i, 'Ootoya 大戸屋'],
  [/yayoi\s*ken|やよい軒/i, 'Yayoiken やよい軒'],
  [/coco\s*ichi|ココイチ|curry house coco/i, 'CoCo Ichibanya ココイチ'],
  [/saizeriya|サイゼリヤ/i, 'Saizeriya サイゼリヤ'],
  [/gusto|ガスト/i, 'Gusto ガスト'],
  [/tenya|てんや/i, 'Tenya てんや'],
  [/marugame|丸亀/i, 'Marugame Seimen 丸亀製麺'],
  [/ichiran|一蘭/i, 'Ichiran 一蘭'],
  [/mos\s*burger|モスバーガー/i, 'MOS Burger モスバーガー'],
  [/mcdonald'?s?|マクドナルド|マック/i, "McDonald's Japan マクドナルド"],
  [/starbucks|スタバ|スターバックス/i, 'Starbucks Japan スターバックス'],
  [/7[\s-]?eleven|seven[\s-]?eleven|セブン/i, '7-Eleven Japan セブンイレブン'],
  [/lawson|ローソン/i, 'Lawson ローソン'],
  [/family\s*mart|famima|ファミマ|ファミリーマート/i, 'FamilyMart ファミリーマート'],
  [/subway|サブウェイ/i, 'Subway Japan サブウェイ'],
  [/kfc|kentucky|ケンタッキー/i, 'KFC Japan ケンタッキー'],
];

/** Where the message says they're eating, or null. A named chain, else "going to / eating at <Place>". */
export function venueIn(text: string): string | null {
  for (const [re, name] of CHAINS) if (re.test(text)) return name;
  const m = /\b(?:going to|go to|heading to|at|in|eating at|ordering (?:from|at)|from)\s+(?:the\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,3})/.exec(text)
    ?? /\b(?:going to|heading to|eating at|ordering from)\s+([a-z][\w'&.-]*(?:\s+[a-z][\w'&.-]*){0,2})\s+(?:for|to|and|tonight|today|now)\b/i.exec(text);
  const place = m?.[1]?.trim();
  if (!place || /^(home|work|the gym|gym|school|office|bed|lunch|dinner|breakfast|japan|tokyo|osaka)$/i.test(place)) return null;
  return place;
}

const KEEP_MS = 3 * 60 * 60 * 1000;
const key = (userId: string) => `diet-menu:${userId}`;

function digest(venue: string, r: SearchResult) {
  const parts = [r.answer ? `Summary: ${r.answer}` : '', ...r.hits.slice(0, 6).map((h) => `- ${h.title} (${h.url}): ${h.snippet.replace(/\s+/g, ' ').slice(0, 600)}`)].filter(Boolean);
  return `Searched the web for ${venue}'s menu nutrition:\n${parts.join('\n')}`.slice(0, 5000);
}

/**
 * The menu facts for this message: searched now when it names a place (and kept 3 hours), else the ones
 * kept from earlier in the meal. `search` is null when the user has no search key connected.
 */
export async function menuFacts(kv: KV, userId: string, text: string, search: ((q: string) => Promise<SearchResult>) | null, now = Date.now()):
  Promise<{ venue: string; facts: string; fresh: boolean } | { venue: string; facts: null; why: string } | null> {
  const venue = venueIn(text);
  if (!venue) {
    const kept = await kv.get(key(userId)).catch(() => null);
    if (!kept) return null;
    try { const k = JSON.parse(kept) as { venue: string; facts: string; at: number }; return now - k.at < KEEP_MS ? { venue: k.venue, facts: k.facts, fresh: false } : null; } catch { return null; }
  }
  if (!search) return { venue, facts: null, why: 'no web search key connected (Tavily, on the Connect page)' };
  try {
    const r = await Promise.race([
      search(`${venue} メニュー カロリー たんぱく質 栄養成分 menu calories protein`),
      new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), 9000)),
    ]);
    if (!r.hits.length && !r.answer) return { venue, facts: null, why: 'the search found nothing' };
    const facts = digest(venue, r);
    await kv.set(key(userId), JSON.stringify({ venue, facts, at: now }), KEEP_MS).catch(() => {});
    return { venue, facts, fresh: true };
  } catch (e) {
    return { venue, facts: null, why: `the search failed (${(e as Error).message})` };
  }
}
