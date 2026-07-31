export const CAFFEINE_HIGH_MG = 150;

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
