import type { RecipeIngredient } from "@shared/schema";
import {
  detectAllergens,
  firstMatchPerIngredient,
  type AllergenMatch,
  type AllergySeverity,
} from "@shared/constants/allergens";
import { normalizeQuantityToDecimal } from "@shared/lib/quantity";
import { categorizeIngredient } from "@shared/lib/grocery-categories";

export interface AggregatedGroceryItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
}

/**
 * Normalize an ingredient name for grouping.
 */
export function normalizeIngredientName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Round to 2 decimals so float sums (0.1 + 0.2) don't persist as 0.30000000000000004. */
export function roundQuantity(n: number): number {
  return Math.round(n * 100) / 100;
}

const RANGE_RE = /^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i;
/** "1-1/2" is a hyphenated mixed number (1½), not the range 1 to ½. */
const HYPHEN_MIXED_RE = /^(\d+)-(\d+\/\d+)(?=\s|$)/;
const FRACTION_GLYPHS = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";
/** Leading numeric token: mixed number, digit+glyph, fraction, decimal, or glyph. */
const LEADING_QTY_RE = new RegExp(
  `^(\\d+\\s+\\d+\\/\\d+|\\d+\\s*[${FRACTION_GLYPHS}]|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[${FRACTION_GLYPHS}])(?![\\d/.])`,
);

/** Parse a quantity that may carry trailing text ("1/2 cup" → 0.5). */
function parseLeadingQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  const whole = normalizeQuantityToDecimal(trimmed);
  if (whole !== null) return Number(whole);
  const token = trimmed.match(LEADING_QTY_RE);
  if (!token) return null;
  const normalized = normalizeQuantityToDecimal(token[1]);
  return normalized !== null ? Number(normalized) : null;
}

/** "1,000" or "12,345,678": a leading non-zero group, then groups of three. */
const THOUSANDS_GROUPED_RE = /(?<![\d.,])([1-9]\d{0,2}(?:,\d{3})+)(?![\d,])/g;
const DECIMAL_COMMA_RE = /(\d),(\d+)/g;

/**
 * The one comma rule for quantities (reliability audit 2026-11-19, L-xc-6): a
 * number written in well-formed thousands groups with a non-zero first digit
 * ("1,000", "1,000,000") drops its commas; any other comma is a decimal comma
 * ("1,5", "1,25", "0,125"). Bare parseFloat read all of these as 1 or 0.
 */
function normalizeQuantityCommas(text: string): string {
  return text
    .replace(THOUSANDS_GROUPED_RE, (group) => group.replace(/,/g, ""))
    .replace(DECIMAL_COMMA_RE, "$1.$2");
}

/**
 * Parse an ingredient quantity string to a number for summing. Handles
 * integers, decimals, fractions ("1/2"), mixed numbers ("1 1/2", "1-1/2") and
 * unicode glyphs via normalizeQuantityToDecimal; a range ("1-2", "2 to 3")
 * takes its upper end so the grocery list never under-buys. Trailing text after
 * the leading quantity is ignored ("1/2 cup" → 0.5, "2-3 cloves" → 3).
 * Negative or non-numeric input returns null.
 * (Bare parseFloat read "1/2" as 1 and "1-2" as 1.)
 */
export function parseQuantityForSum(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const text = normalizeQuantityCommas(trimmed).replace(
    HYPHEN_MIXED_RE,
    "$1 $2",
  );
  const single = parseLeadingQuantity(text);

  const range = text.match(RANGE_RE);
  if (range) {
    const lo = parseLeadingQuantity(range[1]);
    const hi = parseLeadingQuantity(range[2]);
    if (lo !== null && hi !== null) return Math.max(lo, hi);
  }

  // A leading "-" never matches LEADING_QTY_RE, so negatives yield null.
  return single;
}

/**
 * Aggregate recipe ingredients into a grocery list, merging duplicates.
 * Pure function, no DB access.
 */
export function generateGroceryItems(
  ingredients: Pick<
    RecipeIngredient,
    "name" | "quantity" | "unit" | "category"
  >[],
): AggregatedGroceryItem[] {
  const grouped = new Map<
    string,
    { quantity: number | null; unit: string | null; category: string }
  >();

  for (const ing of ingredients) {
    const normalized = normalizeIngredientName(ing.name);
    const unit = ing.unit?.toLowerCase().trim() || null;
    // Group key includes unit so "2 cups flour" and "100g flour" stay separate
    const key = `${normalized}|${unit || ""}`;

    const existing = grouped.get(key);
    const qty = parseQuantityForSum(ing.quantity);

    if (existing) {
      if (existing.quantity !== null && qty !== null) {
        existing.quantity = roundQuantity(existing.quantity + qty);
      } else if (qty !== null) {
        existing.quantity = qty;
      }
    } else {
      grouped.set(key, {
        quantity: qty,
        unit,
        category:
          ing.category && ing.category !== "other"
            ? ing.category
            : categorizeIngredient(normalized),
      });
    }
  }

  const items: AggregatedGroceryItem[] = [];
  for (const [key, value] of grouped) {
    const name = key.split("|")[0];
    items.push({
      name,
      quantity: value.quantity,
      unit: value.unit,
      category: value.category,
    });
  }

  // Sort by category then name
  items.sort((a, b) =>
    a.category === b.category
      ? a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );

  return items;
}

/**
 * Annotates grocery items with allergen matches against the user's profile.
 * Pure function — runs `detectAllergens` over item names.
 */
export function flagAllergenicGroceryItems(
  items: AggregatedGroceryItem[],
  userAllergies: { name: string; severity: AllergySeverity }[],
): Map<string, AllergenMatch> {
  if (userAllergies.length === 0) return new Map();

  const names = items.map((i) => i.name);
  const matches = detectAllergens(names, userAllergies);

  // One match per item name: a definite match wins over a possible one.
  return firstMatchPerIngredient(matches);
}
