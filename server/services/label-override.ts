import type { BarcodeLookupResult, BarcodePer100g } from "./barcode-lookup";
import { parseServingGrams, scaleNutrients } from "./barcode-lookup";

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

/** Relative-difference threshold (25%) and an absolute floor to ignore
 *  rounding noise on near-zero values. Tunable. */
const REL_THRESHOLD = 0.25;
const ABS_FLOOR = 2; // kcal or g — below this on BOTH sides, skip the field

function differs(a: number, b: number): boolean {
  if (a <= ABS_FLOOR && b <= ABS_FLOOR) return false;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  return Math.abs(a - b) / denom > REL_THRESHOLD;
}

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
  if (labelGrams == null || labelGrams <= 0) return none;
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
    if (labelVal != null && dbVal != null && differs(labelVal, dbVal))
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
