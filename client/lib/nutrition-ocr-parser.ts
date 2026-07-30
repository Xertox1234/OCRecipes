/**
 * Pure function parser that extracts structured nutrition data from OCR text.
 * Designed for US nutrition labels in English. Uses line-by-line regex matching
 * with common OCR misread correction.
 */
import { parseLabelServingGrams } from "@shared/lib/label-serving";

export interface LocalNutritionData {
  calories: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  totalCarbs: number | null;
  dietaryFiber: number | null;
  totalSugars: number | null;
  protein: number | null;
  servingSize: string | null;
  confidence: number;
}

/** Fix common OCR character misreads in numeric strings */
function fixOCRDigits(s: string): string {
  return s
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/(?<=\d)S|S(?=\d)/g, "5");
}

/** Maximum plausible value per serving for any nutrition field */
const MAX_NUTRITION_VALUE = 10000;

/** Extract a numeric value from a string, applying OCR correction */
function extractNumber(raw: string): number | null {
  const fixed = fixOCRDigits(raw.trim());
  const num = parseFloat(fixed);
  if (isNaN(num) || num < 0 || num > MAX_NUTRITION_VALUE) return null;
  return num;
}

interface FieldPattern {
  key: keyof Omit<LocalNutritionData, "servingSize" | "confidence">;
  pattern: RegExp;
}

// Canadian/bilingual labels put the English name first with the French name
// after a slash ("Fat / Lipides", "Sugars / Sucres") or use the French name
// alone ("Glucides", "Protéines"). Only the five fields the label-override
// feature reads (fat, saturated fat, sugars, carbs, protein) plus serving size
// are extended for bilingual labels; trans fat, cholesterol, sodium, and fiber
// (none read by the feature) keep their US-only form.
//
// Two additions vs. the US patterns, both regression-safe:
//   1. `(?:\s*\/\s*[a-zà-ÿ]+)?` — an OPTIONAL alternate-name group that steps
//      over the "/ Lipides" half without over-consuming the value.
//   2. `(\S+?)\s*g` — a loose capture (so fixOCRDigits still repairs OCR
//      misreads like "l2" -> 12) followed by an optional space before the unit
//      (for the Canadian "0 g" spacing).
// The bare English tokens "fat" and "sugars" are substrings of "saturated/
// trans fat" and "total sugars", so their bilingual forms are line-anchored
// (`(?:^|\n)\s*`) to keep them from stealing another field's value.
const FIELD_PATTERNS: FieldPattern[] = [
  { key: "calories", pattern: /calories\s+(?!from\b)<?(\S+)/i },
  {
    key: "totalFat",
    pattern:
      /(?:total\s+fat|(?:^|\n)\s*(?:fat|lipides))(?:\s*\/\s*[a-zà-ÿ]+)?\s+<?(\S+?)\s*g/i,
  },
  {
    key: "saturatedFat",
    pattern:
      /(?:saturated\s+fat|(?:^|\n)\s*(?:saturated|satur[ée]s))(?:\s*\/\s*[a-zà-ÿ]+)?\s+<?(\S+?)\s*g/i,
  },
  { key: "transFat", pattern: /trans\s+fat\s+<?(\S+?)g/i },
  { key: "cholesterol", pattern: /cholesterol\s+<?(\S+?)mg/i },
  { key: "sodium", pattern: /sodium\s+<?(\S+?)mg/i },
  {
    key: "totalCarbs",
    pattern:
      /(?:total\s+carb(?:ohydrate|s|\.?)?|carbohydrates?|glucides)(?:\s*\/\s*[a-zà-ÿ]+)?\s+<?(\S+?)\s*g/i,
  },
  { key: "dietaryFiber", pattern: /dietary\s+fiber\s+<?(\S+?)g/i },
  {
    key: "totalSugars",
    pattern:
      /(?:total\s+sugars?|(?:^|\n)\s*(?:sugars?|sucres?))(?:\s*\/\s*[a-zà-ÿ]+)?\s+<?(\S+?)\s*g/i,
  },
  {
    key: "protein",
    pattern: /(?:protein|prot[ée]ines?)(?:\s*\/\s*[a-zà-ÿ]+)?\s+<?(\S+?)\s*g/i,
  },
];

const SERVING_SIZE_PATTERN = /serving\s+size\s+(.+)/i;
// Canadian/bilingual labels head the column with "Per 355 mL" / "pour 250 mL" /
// "Portion". Only accept this form when the capture carries a g/ml token, so a
// stray "Amount per serving" line can't hijack the serving size.
const SERVING_PER_PATTERN =
  /(?:^|\n)\s*(?:per|pour|portion)\s+([^\n]*\d[^\n]*(?:g|ml)[^\n]*)/i;

/** Total number of numeric fields used to calculate confidence */
const TOTAL_FIELDS = FIELD_PATTERNS.length;

export function parseNutritionFromOCR(text: string): LocalNutritionData {
  const result: LocalNutritionData = {
    calories: null,
    totalFat: null,
    saturatedFat: null,
    transFat: null,
    cholesterol: null,
    sodium: null,
    totalCarbs: null,
    dietaryFiber: null,
    totalSugars: null,
    protein: null,
    servingSize: null,
    confidence: 0,
  };

  if (!text.trim()) return result;

  // Extract serving size (free-form text, not numeric). Prefer the US
  // "Serving Size" label; fall back to the Canadian "Per X mL" form only when
  // that capture contains a g/ml token (see SERVING_PER_PATTERN).
  const servingMatch =
    text.match(SERVING_SIZE_PATTERN) ?? text.match(SERVING_PER_PATTERN);
  if (servingMatch) {
    result.servingSize = servingMatch[1].trim().slice(0, 100);
  }

  // Extract numeric fields
  let extracted = 0;
  for (const { key, pattern } of FIELD_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = extractNumber(match[1]);
      if (value !== null) {
        result[key] = value;
        extracted++;
      }
    }
  }

  result.confidence = extracted / TOTAL_FIELDS;

  return result;
}

/**
 * Decides whether a parsed nutrition label is usable as the source of truth.
 *
 * Product rule (user decision, 2026-07-30): **when a nutrition label is present
 * it is the source of truth** — its serving size and calories are adopted over
 * the product database record. So this gate asks for exactly those two:
 *
 * - `calories` — the value being adopted.
 * - `servingSize` — what that value is *per*. Without it there is nothing to
 *   scale by, and the calorie figure would be silently presented as whatever
 *   serving the database assumed. That is the bug this rule exists to fix, so
 *   adopting calories without a serving would just relocate it.
 *
 * It deliberately does NOT also require a sugars-or-fat reading. That looked
 * like cheap corroboration, but the two are not independent: the recogniser's
 * `g` -> `9` substitution breaks the sugars and fat patterns *together*, so one
 * glitch took out both and discarded labels whose calories and serving were
 * perfect. Device-observed on a Cherry Coke can (barcode 06772408) on
 * 2026-07-30 — the screen fell back to the database's per-100 mL figure and
 * showed 39 kcal for a 140 kcal can. The verbatim capture is in the tests.
 *
 * A field that failed to parse is treated as ABSENT, not as evidence the label
 * is wrong: `null` here means "we did not read this", never "the label is
 * untrustworthy".
 */
export function isLabelReady(
  parsed: LocalNutritionData | null | undefined,
): boolean {
  if (parsed == null || parsed.calories == null) return false;
  // Not merely "a serving string was captured" — it must PARSE to grams/ml.
  // `isLabelReady` also suppresses the "we couldn't use that label" notice, so
  // a label this accepts and the server then refuses reaches the user as
  // database values with NO indication the label was dropped — a server
  // refusal returns the same body shape as agreement. A US label reading
  // `Serving Size 1 can`, with no gram/ml figure, is the live case: captured
  // fine, parses to nothing.
  //
  // Shares `parseLabelServingGrams` with the server's `buildLabelConflict`
  // rather than each side calling its own parser — they previously used two
  // different implementations that disagreed on real inputs (`"355"` -> 355
  // here, `null` there), which is precisely how a label could pass this gate
  // and be refused downstream.
  return parseLabelServingGrams(parsed.servingSize) != null;
}
