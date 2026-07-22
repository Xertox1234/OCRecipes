// FSA thresholds are per 100 g (food) / per 100 ml (drink) / per portion (>100 g/ml).
// Sodium is already expressed in mg — these are pre-computed from the FSA's salt (g) x 400
// conversion. Do NOT re-derive salt or re-convert sodium anywhere downstream (single-conversion rule).
export const FSA_FOOD = { sugar: 22.5, saturatedFat: 5.0, sodium: 600 }; // per 100 g; sodium mg
export const FSA_DRINK = { sugar: 11.25, saturatedFat: 2.5, sodium: 300 }; // per 100 ml; sodium mg
export const FSA_PORTION = { sugar: 27, saturatedFat: 6, sodium: 720 }; // per portion >100 g/ml; sodium mg

export const CAFFEINE_HIGH_MG = 150;

export const BEVERAGE_PARENT = "en:beverages";

export const CAFFEINE_CATEGORY_TAGS = [
  "en:energy-drinks",
  "en:coffees",
  "en:colas",
  "en:teas",
  "en:energy-shots",
];

export const CAFFEINE_INGREDIENT_RE =
  /caffeine|caféine|cafeina|cafeína|koffein|guaraná|guarana/i;

// Explicit caffeine-free / decaffeinated declarations (multilingual). When ingredient
// text matches this, the caffeine "presence" signal is suppressed — otherwise a bare
// token in CAFFEINE_INGREDIENT_RE (or a decaf category) would flag a caffeine-FREE product.
export const CAFFEINE_FREE_RE =
  /caffeine[-\s]?free|decaffeinat|\bdecaf\b|koffeinfrei|entkoffeiniert|descafein|sin\s+cafe[íi]na|d[eé]caf[eé]in|sans\s+caf[eé][íi]?ne|senza\s+caffeina|decaffeinato/i;

// Artificial (non-natural, non-polyol) sweeteners. Excludes E960 stevia, sugar alcohols.
export const ARTIFICIAL_SWEETENER_ETAGS = new Set([
  "en:e950",
  "en:e951",
  "en:e952",
  "en:e954",
  "en:e955",
  "en:e961",
  "en:e962",
  "en:e969",
]);

/** Beverage iff the en:beverages PARENT is present (tolerates polluted leaf tags). */
export function isBeverageCategory(tags: string[]): boolean {
  return tags.includes(BEVERAGE_PARENT);
}
