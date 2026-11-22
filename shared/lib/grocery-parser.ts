/**
 * Reads ordinary shopping-list writing ("Milk 2L", "2 cans chopped tomatoes",
 * "a dozen eggs") into a name and an amount. Plain rules, no AI. Design:
 * docs/superpowers/specs/2026-10-31-smarter-grocery-list-design.md.
 *
 * The rule that outranks every other: never lose what was typed. When a
 * reading is in doubt the whole text becomes the name, with no amount.
 *
 * Separate from `client/lib/ingredient-parser.ts` on purpose: that one feeds
 * the recipe form, where trailing amounts and "x2" must not be read.
 */
import { normalizeQuantityToDecimal } from "./quantity";

export interface ParsedGroceryItem {
  /** Tidied name: spaces collapsed, first letter capitalised, nothing else. */
  name: string;
  /** Size of one pack for a measured unit, otherwise how many. */
  quantity: number | null;
  /** Short display label ("L", "can"), or null. Never converted. */
  unit: string | null;
  /** Packs of a measured size ("Milk 2L x2" is 2). 1 everywhere else. */
  count: number;
}

const MEASURED_UNITS = new Set(["L", "ml", "g", "kg", "lb", "oz"]);

/** L, ml, g, kg, lb, oz: units where the amount is the size of one pack. */
export function isMeasuredUnit(unit: string | null | undefined): boolean {
  return !!unit && MEASURED_UNITS.has(unit);
}

/** Spelling (lower case) to the one short label stored and shown. */
const UNIT_LABELS: Record<string, string> = {
  l: "L",
  litre: "L",
  litres: "L",
  liter: "L",
  liters: "L",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  cup: "cup",
  cups: "cup",
  can: "can",
  cans: "can",
  pack: "pack",
  packs: "pack",
  packet: "pack",
  packets: "pack",
  jar: "jar",
  jars: "jar",
  bottle: "bottle",
  bottles: "bottle",
  bunch: "bunch",
  bunches: "bunch",
  loaf: "loaf",
  loaves: "loaf",
  bag: "bag",
  bags: "bag",
  box: "box",
  boxes: "box",
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const MAX_QUANTITY = 9999;
const GLYPHS = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";
/** A mixed number, digit + glyph, fraction, decimal, or lone glyph. */
const NUM = `\\d+\\s+\\d+\\/\\d+|\\d+\\s?[${GLYPHS}]|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[${GLYPHS}]`;
const UNIT_WORD = Object.keys(UNIT_LABELS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join("|");

/**
 * Names whose number is part of the name. A wrong amount cannot be corrected
 * on the list yet, so these are left exactly as typed.
 */
const NUMBER_IS_PART_OF_THE_NAME = [
  /\bhalf\s+(?:and|&|n)\s+half\b/i,
  /\b(?:7|seven)[\s-]?up\b/i,
  /\bheinz\s+57\b/i,
  /\bwd[\s-]?40\b/i,
  /\d\s*(?:%|percent\b)/i,
];

const LEAD_MULTIPLIER_RE = /^(\d{1,2})\s*[x×]\s+(.+)$/i;
const TRAIL_MULTIPLIER_RE = /^(.+?)\s+[x×]\s*(\d{1,2})$/i;
const TRAIL_MULTIPLIER_AFTER_RE = /^(.+?)\s+(\d{1,2})[x×]$/i;

const HALF_DOZEN_RE = /^half\s+an?\s+dozen\s+(?:of\s+)?(.+)$/i;
const COUPLE_RE = /^a\s+couple\s+(?:of\s+)?(.+)$/i;
const DOZEN_RE = new RegExp(
  `^(?:(${NUMBER_WORD}|an?|${NUM})\\s+)?dozen\\s+(?:of\\s+)?(.+)$`,
  "i",
);
const HALF_UNIT_RE = new RegExp(
  `^half\\s+(?:an?\\s+)?(${UNIT_WORD})\\s+(?:of\\s+)?(.+)$`,
  "i",
);
const WORD_UNIT_RE = new RegExp(
  `^(${NUMBER_WORD}|an?)\\s+(${UNIT_WORD})\\s+(?:of\\s+)?(.+)$`,
  "i",
);
const LEAD_NUMBER_RE = new RegExp(`^(${NUM})(.*)$`);
const GLUED_UNIT_RE = /^([a-zA-Z]+)\s+(.+)$/;
const SPACED_UNIT_RE = /^([a-zA-Z]+)\s+(?:of\s+)?(.+)$/;
const TRAIL_UNIT_RE = new RegExp(`^(.+?)\\s+(${NUM})\\s*([a-zA-Z]+)$`);
const TRAIL_BARE_RE = /^(.+?)\s+(\d{1,2})$/;
/** A name ending in a single letter or one of these takes its number as a label. */
const NUMBER_NAMES_THE_PRODUCT_RE =
  /(?:^|\s)(?:[a-z]|stage|size|step|phase|level|grade|type|no\.?|number|factor|spf|omega|formula|series)$/i;

/** Trim, collapse spaces, drop a leading "some", capitalise the first letter. */
export function tidyGroceryName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const name = collapsed.replace(/^some\s+(?=\S)/i, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface Amount {
  name: string;
  quantity: number;
  unit: string | null;
}

function toNumber(token: string): number | null {
  const lower = token.toLowerCase();
  if (lower === "a" || lower === "an") return 1;
  if (lower in NUMBER_WORDS) return NUMBER_WORDS[lower];
  const decimal = normalizeQuantityToDecimal(token);
  return decimal === null ? null : Number(decimal);
}

const unitLabel = (word: string): string | null =>
  UNIT_LABELS[word.toLowerCase()] ?? null;

/** An amount written before the name: "2L milk", "a dozen eggs". */
function leadingAmount(text: string): Amount | null {
  const halfDozen = text.match(HALF_DOZEN_RE);
  if (halfDozen) return { name: halfDozen[1], quantity: 6, unit: null };

  const couple = text.match(COUPLE_RE);
  if (couple) return { name: couple[1], quantity: 2, unit: null };

  const dozen = text.match(DOZEN_RE);
  if (dozen) {
    const n = dozen[1] === undefined ? 1 : toNumber(dozen[1]);
    return n === null ? null : { name: dozen[2], quantity: n * 12, unit: null };
  }

  const half = text.match(HALF_UNIT_RE);
  if (half) return { name: half[2], quantity: 0.5, unit: unitLabel(half[1]) };

  const worded = text.match(WORD_UNIT_RE);
  if (worded) {
    const n = toNumber(worded[1]);
    return n === null
      ? null
      : { name: worded[3], quantity: n, unit: unitLabel(worded[2]) };
  }

  const numbered = text.match(LEAD_NUMBER_RE);
  if (!numbered) return null;
  const quantity = toNumber(numbered[1]);
  if (quantity === null) return null;
  const after = numbered[2];

  if (/^[a-zA-Z]/.test(after)) {
    // Letters glued to the number must be a unit ("2L"), or it is no amount.
    const glued = after.match(GLUED_UNIT_RE);
    const unit = glued ? unitLabel(glued[1]) : null;
    if (!glued || !unit) return null;
    return { name: glued[2].replace(/^of\s+(?=\S)/i, ""), quantity, unit };
  }
  if (!/^\s/.test(after)) return null;

  const rest = after.trim();
  const spaced = rest.match(SPACED_UNIT_RE);
  const unit = spaced ? unitLabel(spaced[1]) : null;
  if (spaced && unit) return { name: spaced[2], quantity, unit };
  return { name: rest, quantity, unit: null };
}

/** An amount written after the name: "Milk 2L", "eggs 12". */
function trailingAmount(text: string): Amount | null {
  const withUnit = text.match(TRAIL_UNIT_RE);
  if (withUnit) {
    const quantity = toNumber(withUnit[2]);
    const unit = unitLabel(withUnit[3]);
    if (quantity !== null && unit) return { name: withUnit[1], quantity, unit };
  }
  const bare = text.match(TRAIL_BARE_RE);
  // "Vitamin B 12", "stage 2", "size 4": the number names the product.
  if (bare && !NUMBER_NAMES_THE_PRODUCT_RE.test(bare[1])) {
    return { name: bare[1], quantity: Number(bare[2]), unit: null };
  }
  return null;
}

function readAmount(text: string): Amount | null {
  const amount = leadingAmount(text) ?? trailingAmount(text);
  // A number still in the name ("Lays 2 for 1", "12 34") makes the reading
  // doubtful, and a doubtful reading is added as typed.
  return amount && !/\d/.test(amount.name) ? amount : null;
}

/**
 * Parse one typed or spoken item. Unreadable input comes back as typed, with
 * no amount: adding an item never fails and never asks a question.
 */
export function parseGroceryText(raw: string): ParsedGroceryItem {
  const asTyped: ParsedGroceryItem = {
    name: tidyGroceryName(raw),
    quantity: null,
    unit: null,
    count: 1,
  };
  let text = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^some\s+(?=\S)/i, "");
  if (!text || NUMBER_IS_PART_OF_THE_NAME.some((re) => re.test(text))) {
    return asTyped;
  }

  let multiplier: number | null = null;
  const lead = text.match(LEAD_MULTIPLIER_RE);
  const trail =
    text.match(TRAIL_MULTIPLIER_RE) ?? text.match(TRAIL_MULTIPLIER_AFTER_RE);
  if (lead) {
    multiplier = Number(lead[1]);
    text = lead[2];
  } else if (trail) {
    multiplier = Number(trail[2]);
    text = trail[1];
  }
  if (multiplier !== null && multiplier < 1) return asTyped;

  const amount = readAmount(text);

  let name = text;
  let quantity: number | null = multiplier;
  let unit: string | null = null;
  let count = 1;
  if (amount) {
    // "2 x 3 apples": a multiplier only makes sense on a measured pack size.
    if (multiplier !== null && !isMeasuredUnit(amount.unit)) return asTyped;
    ({ name, quantity, unit } = amount);
    count = multiplier ?? 1;
  }
  if (quantity === null) return asTyped;

  quantity = Math.round(quantity * 100) / 100;
  if (quantity <= 0 || quantity > MAX_QUANTITY) return asTyped;
  return { name: tidyGroceryName(name), quantity, unit, count };
}
