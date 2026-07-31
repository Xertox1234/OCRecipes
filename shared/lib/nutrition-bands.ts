import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  FIBRE_CLAIM,
  PROTEIN_ENERGY_CLAIM,
} from "@shared/constants/nutrition-bands";

export type ConcernNutrient = "sugar" | "saturatedFat" | "sodium" | "fat";
export type BenefitNutrient = "fibre" | "protein";

export type ConcernBand = "high" | "medium" | "low" | "unknown";
export type BenefitBand = "excellent" | "good" | "none" | "unknown";

/**
 * How to place a per-serving value on a per-100 scale.
 *
 * `kind: "unknown"` is the load-bearing case: it means we have a number but
 * no trustworthy denominator or no idea which scale applies, and every band
 * derived from it is `unknown` — which the UI renders unbanded. A red dot
 * derived from an invented denominator is a confident false claim about
 * someone's food.
 */
export type Basis =
  | {
      kind: "resolved";
      scale: "food" | "drink";
      /** Multiply a per-serving value by this to get per-100. 1 when already per-100. */
      factor: number;
    }
  | { kind: "unknown" };

/** Nutrients with a published per-portion RED override. Total fat has none. */
const PORTION_LINES: Partial<Record<ConcernNutrient, number>> = {
  sugar: FSA_PORTION.sugar,
  saturatedFat: FSA_PORTION.saturatedFat,
  sodium: FSA_PORTION.sodium,
};

/**
 * Classify a concern nutrient into a traffic-light band (high/medium/low).
 *
 * Precondition: When `portionGrams` is supplied, it must be the weight of the
 * same portion that `perServingValue` describes. When `basis.factor` is 1
 * (values already per-100), `portionGrams` should not be supplied.
 *
 * The per-portion override can only promote to high, only for portions over
 * 100 g/ml, and only on the food scale (FSA_PORTION applies to food only).
 */
export function concernBand(
  nutrient: ConcernNutrient,
  perServingValue: number | undefined,
  basis: Basis,
  portionGrams?: number | null,
): ConcernBand {
  if (basis.kind === "unknown") return "unknown";
  if (perServingValue === undefined || !Number.isFinite(perServingValue)) {
    return "unknown";
  }

  const limits = (basis.scale === "drink" ? FSA_DRINK : FSA_FOOD)[nutrient];
  const per100 = perServingValue * basis.factor;

  // The per-portion override can only ever promote TO high, and only for
  // portions over 100 g/ml. Skipping it when the weight is unknown fails
  // toward under-warning, which is the established direction for nutrient
  // flags (allergen flags fail the other way).
  const portionLine = PORTION_LINES[nutrient];
  if (
    basis.scale === "food" &&
    portionLine !== undefined &&
    portionGrams != null &&
    portionGrams > 100 &&
    perServingValue > portionLine
  ) {
    return "high";
  }

  if (per100 > limits.high) return "high";
  if (per100 > limits.low) return "medium";
  return "low";
}

export function benefitBand(
  nutrient: BenefitNutrient,
  perServingValue: number | undefined,
  basis: Basis,
  kcalPerServing?: number | undefined,
): BenefitBand {
  if (basis.kind === "unknown") return "unknown";
  if (perServingValue === undefined || !Number.isFinite(perServingValue)) {
    return "unknown";
  }

  if (nutrient === "protein") {
    // Energy share, not an absolute weight — 20g of protein means something
    // different in a 200kcal meal than in a 900kcal one.
    if (
      kcalPerServing === undefined ||
      !Number.isFinite(kcalPerServing) ||
      kcalPerServing <= 0
    ) {
      return "unknown";
    }
    const share = (perServingValue * 4) / kcalPerServing;
    if (share >= PROTEIN_ENERGY_CLAIM.excellent) return "excellent";
    if (share >= PROTEIN_ENERGY_CLAIM.good) return "good";
    return "none";
  }

  const per100 = perServingValue * basis.factor;
  if (per100 >= FIBRE_CLAIM.excellent) return "excellent";
  if (per100 >= FIBRE_CLAIM.good) return "good";
  return "none";
}
