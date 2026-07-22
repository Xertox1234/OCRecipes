import type { BarcodeLookupResult, BarcodePer100g } from "./barcode-lookup";
import { parseServingGrams, scaleNutrients } from "./barcode-lookup";
import { valuesMatch } from "../lib/verification-consensus";

export interface LabelNutritionInput {
  calories: number | null;
  totalSugars: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  servingSize: string | null;
}

export type ConflictField = "calories" | "sugar" | "fat";

export interface LabelConflict {
  conflict: boolean;
  fields: ConflictField[];
  labelResult?: BarcodeLookupResult;
}

/** Relative-difference threshold (25%) for calling a label-vs-DB macro a
 *  material conflict. Comparison itself reuses the codebase's single nutrition
 *  agreement policy (`valuesMatch`), which also applies the shared near-zero
 *  absolute floor — so label-override and verification/OFF-consistency can't
 *  drift into two different notions of "these numbers agree". */
const REL_THRESHOLD = 0.25;

/** Upper plausibility bound for a label-derived serving (grams/ml). A single
 *  beverage serving tops out around a 2 L bottle; a larger value is almost
 *  certainly an OCR digit-insertion misread ("355" → "3550"). Per the spec's
 *  "on doubt, fail toward the DB result" rule we then decline to override.
 *  Deliberately more generous than barcode-lookup's 500 g bound, which targets
 *  DB per-serving sanity, not user-scanned beverage labels. */
const MAX_PLAUSIBLE_LABEL_SERVING_GRAMS = 2000;

/**
 * Compare a scanned label against the DB result and, on a material conflict,
 * build a label-corrected result. Pure — no I/O. The label is per-serving; it
 * is normalized to per-100 using the label's own parsed serving grams.
 */
export function buildLabelConflict(
  dbResult: BarcodeLookupResult,
  label: LabelNutritionInput,
): LabelConflict {
  const none: LabelConflict = { conflict: false, fields: [] };

  // Presence gate: need calories + at least one comparable macro.
  const hasCalories = label.calories != null;
  const hasMacro = label.totalSugars != null || label.totalFat != null;
  if (!hasCalories || !hasMacro) return none;

  // Comparable only if the label serving parses to grams/ml.
  const labelGrams = label.servingSize
    ? parseServingGrams(label.servingSize)
    : null;
  if (
    labelGrams == null ||
    labelGrams <= 0 ||
    labelGrams > MAX_PLAUSIBLE_LABEL_SERVING_GRAMS
  )
    return none;
  const factor = 100 / labelGrams;

  // Normalize the label's per-serving reads to per-100.
  const per100: Partial<
    Record<"calories" | "sugar" | "fat" | "saturatedFat", number>
  > = {};
  if (label.calories != null) per100.calories = label.calories * factor;
  if (label.totalSugars != null) per100.sugar = label.totalSugars * factor;
  if (label.totalFat != null) per100.fat = label.totalFat * factor;
  if (label.saturatedFat != null)
    per100.saturatedFat = label.saturatedFat * factor;

  // Compare the read fields against the DB per-100.
  const fields: ConflictField[] = [];
  const cmp: [ConflictField, number | undefined, number | undefined][] = [
    ["calories", per100.calories, dbResult.per100g.calories],
    ["sugar", per100.sugar, dbResult.per100g.sugar],
    ["fat", per100.fat, dbResult.per100g.fat],
  ];
  for (const [name, labelVal, dbVal] of cmp) {
    if (
      labelVal != null &&
      dbVal != null &&
      !valuesMatch(labelVal, dbVal, REL_THRESHOLD)
    )
      fields.push(name);
  }
  if (fields.length === 0) return none;

  // Build the label-corrected result: label macros over the DB per-100, keep
  // all OFF enrichment, mark serving trusted so evaluateUniversalFlags gets the
  // per-portion path.
  const mergedPer100g: BarcodePer100g = { ...dbResult.per100g, ...per100 };
  const labelResult: BarcodeLookupResult = {
    ...dbResult,
    per100g: mergedPer100g,
    perServing: scaleNutrients(mergedPer100g, labelGrams / 100),
    servingInfo: {
      displayLabel: label.servingSize ?? `${labelGrams}g`,
      grams: labelGrams,
      wasCorrected: false,
    },
    isServingDataTrusted: true,
    source: `${dbResult.source}+label`,
  };

  return { conflict: true, fields, labelResult };
}
