// Exact numbers for the foods people log every day. The model guessed them — and guessed raw chicken with
// cooked-chicken values (165 kcal / 31 g per 100 g instead of ~105 / 23), the same eggs at 70 and then 78
// kcal each. A logged item that names one of these foods with an amount ("220g raw chicken breast",
// "3 boiled eggs", "4 tbsp plain yogurt") gets its numbers from this table instead, and the coach is told
// the table so its words match. Values per 100 g (edible part), from the Japanese Standard Tables of Food
// Composition (8th ed.) where there's an entry, else USDA.
export type Per100 = { kcal: number; protein: number; fat: number; carbs: number };
export type Food = { key: string; label: string; match: RegExp; not?: RegExp; per100: Per100; each?: number; tbsp?: number; needs?: RegExp };

const COOKED = /\b(cooked|grilled|boiled|roast(ed)?|baked|steamed|pan[- ]?fried|sous[- ]?vide)\b|焼|茹|ゆで|蒸/;
const RAW = /\b(raw|uncooked)\b|生/;

export const FOODS: Food[] = [
  { key: 'chicken-breast-raw', label: 'chicken breast, skinless, raw', match: /chicken breast|鶏むね|鶏胸|むね肉|胸肉/, needs: RAW, not: COOKED, per100: { kcal: 105, protein: 23.3, fat: 1.9, carbs: 0.1 } },
  { key: 'chicken-breast-cooked', label: 'chicken breast, skinless, cooked', match: /chicken breast|鶏むね|鶏胸|むね肉|胸肉/, needs: COOKED, not: RAW, per100: { kcal: 165, protein: 31, fat: 3.6, carbs: 0 } },
  { key: 'chicken-thigh-raw', label: 'chicken thigh, skinless, raw', match: /chicken thigh|鶏もも|もも肉/, needs: RAW, not: /\bwith skin\b|皮付き|皮つき/, per100: { kcal: 113, protein: 19, fat: 5, carbs: 0 } },
  { key: 'rice-cooked', label: 'white rice, cooked', match: /\b(white )?rice\b|ご飯|ごはん|白米|めし/, needs: /\bcooked\b|ご飯|ごはん|めし|\bsteamed\b/, not: /\b(brown|fried|cake|cracker|curry|porridge|noodle|ball|uncooked|dry)\b|玄米|チャーハン|おにぎり|カレー/, per100: { kcal: 156, protein: 2.5, fat: 0.3, carbs: 37.1 } },
  { key: 'rice-uncooked', label: 'white rice, uncooked', match: /\b(white )?rice\b|白米|精白米/, needs: /\b(uncooked|dry|raw)\b|生米/, not: /\b(brown|cake|cracker)\b|玄米/, per100: { kcal: 342, protein: 6.1, fat: 0.9, carbs: 77.6 } },
  { key: 'brown-rice-cooked', label: 'brown rice, cooked', match: /brown rice|玄米/, needs: /\bcooked\b|ご飯|ごはん|めし/, per100: { kcal: 152, protein: 2.8, fat: 1, carbs: 35.6 } },
  { key: 'egg', label: 'egg, whole (one = 50 g)', match: /\beggs?\b|卵|たまご|玉子/, not: /\b(white|whites|yolk|fried rice|benedict|omelet|omelette|roll|sandwich|noodle|custard|mayo)\b|卵白|卵黄|オムレツ|サンド/, per100: { kcal: 142, protein: 12.2, fat: 10.2, carbs: 0.4 }, each: 50 },
  { key: 'egg-white', label: 'egg white', match: /egg whites?|卵白/, per100: { kcal: 44, protein: 10.1, fat: 0, carbs: 0.5 }, each: 33 },
  { key: 'oats', label: 'rolled oats, dry', match: /\boat(s|meal)?\b|オートミール/, not: /\b(cooked|milk|bar|cookie)\b/, per100: { kcal: 350, protein: 13.7, fat: 5.7, carbs: 69.1 } },
  { key: 'banana', label: 'banana (one ≈ 100 g edible)', match: /\bbananas?\b|バナナ/, not: /\b(bread|chips|cake|smoothie|shake)\b/, per100: { kcal: 93, protein: 1.1, fat: 0.2, carbs: 22.5 }, each: 100 },
  { key: 'tofu-firm', label: 'tofu, firm (momen)', match: /\b(firm|momen) tofu\b|木綿豆腐|木綿/, per100: { kcal: 73, protein: 7, fat: 4.9, carbs: 1.5 } },
  { key: 'tofu-silken', label: 'tofu, silken (kinu)', match: /\b(silken|kinu) tofu\b|絹豆腐|絹ごし/, per100: { kcal: 56, protein: 5.3, fat: 3.5, carbs: 2 } },
  { key: 'natto', label: 'natto (one pack = 45 g)', match: /\bnatto\b|納豆/, per100: { kcal: 190, protein: 16.5, fat: 10, carbs: 12.1 }, each: 45 },
  { key: 'milk', label: 'milk, whole', match: /\b(whole )?milk\b|牛乳/, not: /\b(protein|latte|coffee|tea|soy|oat|almond|chocolate|skim|low[- ]fat|powder|savas)\b|ザバス|豆乳/, per100: { kcal: 61, protein: 3.3, fat: 3.8, carbs: 4.8 } },
  { key: 'yogurt-plain', label: 'plain yogurt (e.g. Meiji Bulgaria) — 1 tbsp = 15 g', match: /\b(plain|natural|bulgaria)\b.*\byog(h)?urt\b|\byog(h)?urt\b.*\bplain\b|meiji.*yog(h)?urt|プレーンヨーグルト|ブルガリア/, not: /\b(greek|oikos|drink|low[- ]fat|zero)\b/, per100: { kcal: 56, protein: 3.6, fat: 3, carbs: 4.9 }, tbsp: 15 },
  { key: 'tuna-lean-raw', label: 'tuna, lean (maguro akami), raw / sashimi', match: /\b(tuna|maguro)\b|まぐろ|マグロ|鮪/, needs: /\b(sashimi|raw|steak|akami)\b|刺身|赤身|生/, not: /\b(nigiri|gunkan|mayo|mayonnaise|canned|can|roll|onigiri|kimchi|sushi|toro|salad|sandwich)\b|ツナ|トロ|寿司|鮨/, per100: { kcal: 115, protein: 26.4, fat: 1.4, carbs: 0.1 } },
  { key: 'salmon-farmed', label: 'salmon, farmed (sushi / sashimi サーモン)', match: /\bsalmon\b|サーモン/, needs: /\b(sashimi|no rice|without rice)\b|刺身|サーモン/, not: /\b(smoked|grilled|baked|cooked|nigiri|roll|onigiri|sushi)\b(?!.*\b(no|without) rice)|焼/, per100: { kcal: 218, protein: 20.1, fat: 16.5, carbs: 0.1 } },
  { key: 'salmon-raw', label: 'salmon (shirozake), raw', match: /\bsalmon\b|鮭|さけ|サーモン/, needs: RAW, not: COOKED, per100: { kcal: 124, protein: 22.3, fat: 4.1, carbs: 0.1 } },
  { key: 'sweet-potato-raw', label: 'sweet potato, raw', match: /sweet potato|さつまいも|さつま芋/, needs: RAW, per100: { kcal: 126, protein: 1.2, fat: 0.2, carbs: 31.9 } },
  { key: 'olive-oil', label: 'olive oil — 1 tbsp = 13 g', match: /olive oil|オリーブオイル/, per100: { kcal: 894, protein: 0, fat: 100, carbs: 0 }, tbsp: 13 },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

/** How much the name says, in grams: "220g", "220 g", "3 eggs", "4 tbsp", "2 packs of natto". */
export function gramsIn(name: string, food: Food): number | null {
  const t = name.toLowerCase();
  const g = /(\d+(?:\.\d+)?)\s*(g|gr|grams?|グラム)(?![a-z])/.exec(t);
  if (g) return Number(g[1]);
  const ml = /(\d+(?:\.\d+)?)\s*ml\b/.exec(t);
  if (ml && food.key === 'milk') return Number(ml[1]) * 1.03;
  const tbsp = /(\d+(?:\.\d+)?)\s*(tbsp|tablespoons?|table spoons?|大さじ)/.exec(t);
  if (tbsp && food.tbsp) return Number(tbsp[1]) * food.tbsp;
  const count = /(?:^|\D)(\d+(?:\.\d+)?)\s*(x\s*)?(?:(?:large|medium|small|whole|boiled|hard[- ]boiled|soft[- ]boiled|poached|fried|raw|packs? of|pcs?)\s+)*(eggs?|egg whites?|bananas?|natto|packs?|卵|たまご|個|本|パック)/.exec(t);
  if (count && food.each) return Number(count[1]) * food.each;
  if (food.each && /\b(an?|one)\s+(?:(?:large|medium|small|whole|boiled|hard[- ]boiled|fried)\s+)*(egg|banana|egg white)\b/.test(t)) return food.each;
  return null;
}

/** The table food a logged name is, when it says enough (raw or cooked, where that matters). */
export function findFood(name: string): Food | null {
  const t = name.toLowerCase();
  // the most specific first: egg white before egg
  for (const f of [...FOODS].sort((a, b) => (b.key.includes('white') ? 1 : 0) - (a.key.includes('white') ? 1 : 0))) {
    if (!f.match.test(t) || f.not?.test(t) || (f.needs && !f.needs.test(t))) continue;
    return f;
  }
  return null;
}

/**
 * The item with exact numbers when it's a table food with an amount ("220g raw chicken breast" → 231 kcal,
 * P 51.3); otherwise unchanged. A meal of several foods in one item ("chicken and rice") is left alone.
 */
export function exactItem<T extends { name: string; kcal: number; protein: number; fat: number; carbs: number }>(item: T): T {
  if (/\b(and|with|\+|&)\b|と|、/.test(item.name.toLowerCase().replace(/\bwith skin\b/, ''))) return item;
  const food = findFood(item.name);
  if (!food) return item;
  const grams = gramsIn(item.name, food);
  if (!grams || grams > 3000) return item;
  const k = grams / 100;
  return { ...item, kcal: Math.round(food.per100.kcal * k), protein: round1(food.per100.protein * k), fat: round1(food.per100.fat * k), carbs: round1(food.per100.carbs * k) };
}

/** The table, for the coach's prompt. */
export const foodTableText = () => FOODS.map((f) => `${f.label}: ${f.per100.kcal} kcal, P ${f.per100.protein}, F ${f.per100.fat}, C ${f.per100.carbs} per 100 g`).join('\n');
