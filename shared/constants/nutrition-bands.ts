/**
 * Nutrient band thresholds, shared by the server's flag emission and the
 * client's traffic-light panel. ONE set of numbers — a client-side copy is
 * how display and emission desync, which this repo has already been bitten by.
 *
 * SOURCES — check the numbers against these, not against this file:
 * - Concern bands: UK FSA / DH "Guide to creating a front of pack (FoP)
 *   nutrition label for pre-packed products sold through retail outlets"
 *   (the red/amber/green criteria).
 *   https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/566251/FoP_Nutrition_labelling_UK_guidance.pdf
 *   LOW and MEDIUM are per 100 g / 100 ml; the HIGH band additionally uses a
 *   per-portion override — for portions over 100 g on the food scale and over
 *   150 ml on the drink scale ("'per portion' criteria for red ... applied to
 *   drinks served in portion sizes over 150 ml"), which is why the two portion
 *   tables are red-only.
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
 * Per-portion RED lines, one table per FSA scale. RED-ONLY by FSA design —
 * there is no published green band for portions.
 *
 * THE TRIGGER LIVES IN THE TABLE, not beside it. Separating them is the defect
 * this shape exists to prevent: a single `FSA_PORTION` constant whose name did
 * not say "food" was applied to drinks in two different layers, months apart,
 * by two authors who each read the silence as "scale-agnostic". Selecting a
 * table now carries its own trigger, so a caller cannot pick the drink lines
 * and keep the food trigger.
 *
 * `triggerGrams` is millilitres on the drink table. Portion weight is carried
 * as grams for both scales throughout the codebase (`servingInfo.grams` is 355
 * for a 355 mL can), so one field name serves both.
 *
 * Both tables omit `fat` DELIBERATELY. The FSA does publish per-portion fat
 * thresholds (>21 g food, >10.5 g drink), but no total-fat flag is emitted
 * anywhere in the app, so the key would be dead data. If you need to emit a fat
 * flag, that flag and both keys must be added together.
 */
export const FSA_PORTION_FOOD = {
  triggerGrams: 100,
  lines: { sugar: 27, saturatedFat: 6, sodium: 720 },
} as const;

/**
 * Per portion, DRINK scale — roughly half the food figures, at a larger
 * trigger. Sodium is salt (g) x 400 like every other sodium figure here
 * (0.9 g salt -> 360 mg). See `FSA_PORTION_FOOD` for the shape's rationale.
 */
export const FSA_PORTION_DRINK = {
  triggerGrams: 150,
  lines: { sugar: 13.5, saturatedFat: 3, sodium: 360 },
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
