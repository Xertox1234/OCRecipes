/**
 * Nutrient band thresholds, shared by the server's flag emission and the
 * client's traffic-light panel. ONE set of numbers — a client-side copy is
 * how display and emission desync, which this repo has already been bitten by.
 *
 * SOURCES — check the numbers against these, not against this file:
 * - Concern bands: UK FSA front-of-pack nutrition labelling guidance (the
 *   red/amber/green criteria). LOW and MEDIUM are per 100 g / 100 ml; the
 *   HIGH band additionally uses a per-portion override for portions over
 *   100 g/ml, which is why FSA_PORTION is red-only.
 * - Benefit bands: EU Regulation 1924/2006, Annex (nutrition claims) —
 *   "source of fibre" / "high fibre", "source of protein" / "high protein".
 *
 * SODIUM IS IN MILLIGRAMS, pre-converted from the FSA's salt figures at
 * salt (g) x 400. Do NOT re-derive salt or re-convert sodium downstream
 * (single-conversion rule).
 */

/** A concern nutrient's two band boundaries. MEDIUM is the open interval between them. */
export interface ConcernBandLimits {
  /** At or below this value the nutrient is LOW (green). */
  low: number;
  /** Above this value the nutrient is HIGH (red). */
  high: number;
}

/** Per 100 g. */
export const FSA_FOOD = {
  sugar: { low: 5.0, high: 22.5 },
  saturatedFat: { low: 1.5, high: 5.0 },
  fat: { low: 3.0, high: 17.5 },
  sodium: { low: 120, high: 600 },
} as const satisfies Record<string, ConcernBandLimits>;

/** Per 100 ml. */
export const FSA_DRINK = {
  sugar: { low: 2.5, high: 11.25 },
  saturatedFat: { low: 0.75, high: 2.5 },
  fat: { low: 1.5, high: 8.75 },
  sodium: { low: 120, high: 300 },
} as const satisfies Record<string, ConcernBandLimits>;

/**
 * Per portion, FOOD scale only (triggers at portion > 100 g). RED-ONLY by FSA
 * design — there is no published green band for portions. The FSA publishes a
 * per-portion fat threshold (>21 g), but this constant omits the fat key
 * because no total-fat flag is emitted anywhere in the app today — adding it
 * would be dead data. If you need to emit a fat flag, that flag and this key
 * must be added together.
 *
 * Note: The FSA also publishes a separate per-portion table for drinks with
 * different thresholds (fat >10.5 g) and a different trigger (portion > 150 ml).
 * That table is not implemented here.
 */
export const FSA_PORTION = {
  sugar: 27,
  saturatedFat: 6,
  sodium: 720,
} as const;

/**
 * Grams of fibre per 100 g. Per EU 1924/2006 Annex, comparison is INCLUSIVE
 * (>= this value = claim applies) — use "at least" wording in UI. Note: This
 * implements per-100g basis only; the regulation's alternative per-100kcal
 * basis (good: >= 1.5 g/100 kcal, excellent: >= 3 g/100 kcal) is not here.
 */
export const FIBRE_CLAIM = { good: 3, excellent: 6 } as const;

/**
 * Protein energy as a fraction of total energy (protein_g * 4 / kcal). Per
 * EU 1924/2006 Annex, comparison is INCLUSIVE (>= this value = claim applies)
 * — use "at least" wording in UI.
 */
export const PROTEIN_ENERGY_CLAIM = { good: 0.12, excellent: 0.2 } as const;

export const BEVERAGE_PARENT = "en:beverages";

/** Beverage iff the en:beverages PARENT is present (tolerates polluted leaf tags). */
export function isBeverageCategory(tags: string[]): boolean {
  return tags.includes(BEVERAGE_PARENT);
}
