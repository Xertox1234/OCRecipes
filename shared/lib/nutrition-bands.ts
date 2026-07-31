import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  FIBRE_CLAIM,
  PROTEIN_ENERGY_CLAIM,
} from "@shared/constants/nutrition-bands";
import { parseServingBasis } from "@shared/lib/label-serving";

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

export interface ResolveBasisInput {
  /** True when the caller's nutrient values are ALREADY per 100 g/ml. */
  valuesArePer100: boolean;
  /** The product's serving string, e.g. "1 can (355 mL)". */
  servingSize: string | null | undefined;
  /**
   * Derived scale flag from the barcode response. Absent on the saved-item
   * path, the direct-OFF fallback, and bundles predating it.
   */
  isBeverage: boolean | null | undefined;
}

/**
 * Decides whether a set of nutrient values can be placed on an FSA scale at
 * all, and if so on which one.
 *
 * Deliberately does NOT read `effectivePer100g` from useNutritionLookup:
 * that value back-calculates with `servingSizeGrams || 100`, and on the
 * saved-item path `servingSizeGrams` is never set, so it returns per-serving
 * numbers labelled per-100g. Consuming it here is exactly what would arm that
 * latent defect. See
 * todos/P2-2026-07-31-effective-per100g-fabricates-basis-on-saved-item-path.md
 */
export function resolveBasis(input: ResolveBasisInput): Basis {
  const parsed = parseServingBasis(input.servingSize);

  // Scale: the explicit flag wins (a drink sold by weight is still a drink);
  // otherwise the serving unit, which mirrors the FSA's own per-100g vs
  // per-100ml split. Never a default — food thresholds are roughly double
  // drink thresholds, so guessing food under-warns on every untagged drink.
  const scale: "food" | "drink" | null =
    input.isBeverage === true
      ? "drink"
      : input.isBeverage === false
        ? "food"
        : parsed
          ? parsed.unit === "ml"
            ? "drink"
            : "food"
          : null;

  if (scale === null) return { kind: "unknown" };

  if (input.valuesArePer100) return { kind: "resolved", scale, factor: 1 };

  if (!parsed) return { kind: "unknown" };
  return { kind: "resolved", scale, factor: 100 / parsed.quantity };
}

/** Fixed order. Ties break here, so the same product always shows the same rows. */
const CONCERN_ORDER: readonly ConcernNutrient[] = [
  "sugar",
  "saturatedFat",
  "sodium",
  "fat",
];
const BENEFIT_ORDER: readonly BenefitNutrient[] = ["fibre", "protein"];

const CONCERN_RANK: Record<ConcernBand, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};
const BENEFIT_RANK: Record<BenefitBand, number> = {
  excellent: 3,
  good: 2,
  none: 1,
  unknown: 0,
};

export interface BandedValue<B> {
  band: B;
  /** False when the nutrient has no recorded value at all (distinct from zero). */
  hasValue: boolean;
}

export interface NutrientBands {
  concerns: Partial<Record<ConcernNutrient, BandedValue<ConcernBand>>>;
  benefits: Partial<Record<BenefitNutrient, BandedValue<BenefitBand>>>;
}

export type Standout =
  | {
      group: "concern";
      nutrient: ConcernNutrient;
      band: ConcernBand;
      hasValue: boolean;
    }
  | {
      group: "benefit";
      nutrient: BenefitNutrient;
      band: BenefitBand;
      hasValue: boolean;
    };

/**
 * Picks the two nutrients worth promoting into the summary card — the worst
 * concern and the best benefit on THIS product.
 *
 * Iterates the fixed ORDER arrays rather than Object.keys, so the result
 * cannot depend on how the input object was built.
 */
export function pickStandouts(bands: NutrientBands): Standout[] {
  // Rule 3, slot one: worst concern at MEDIUM or above.
  let concern: Standout | null = null;
  let bestConcernRank = CONCERN_RANK.medium - 1;
  for (const n of CONCERN_ORDER) {
    const entry = bands.concerns[n];
    if (!entry) continue;
    const rank = CONCERN_RANK[entry.band];
    if (rank >= CONCERN_RANK.medium && rank > bestConcernRank) {
      bestConcernRank = rank;
      concern = {
        group: "concern",
        nutrient: n,
        band: entry.band,
        hasValue: entry.hasValue,
      };
    }
  }

  // Rule 3, slot two: best benefit at GOOD or above.
  let benefit: Standout | null = null;
  let bestBenefitRank = BENEFIT_RANK.good - 1;
  for (const n of BENEFIT_ORDER) {
    const entry = bands.benefits[n];
    if (!entry) continue;
    const rank = BENEFIT_RANK[entry.band];
    if (rank >= BENEFIT_RANK.good && rank > bestBenefitRank) {
      bestBenefitRank = rank;
      benefit = {
        group: "benefit",
        nutrient: n,
        band: entry.band,
        hasValue: entry.hasValue,
      };
    }
  }

  // Rule 4: if exactly one slot filled, the other is ALWAYS fibre — whatever
  // its band, including `none` and `unknown`. This is what guarantees fibre
  // appears on every product (Decision 3).
  if (concern && !benefit) {
    const fibre = bands.benefits.fibre;
    if (fibre) {
      benefit = {
        group: "benefit",
        nutrient: "fibre",
        band: fibre.band,
        hasValue: fibre.hasValue,
      };
    }
  }

  // Rule 5, benefit half: neither slot filled. Promote fibre only if it has a
  // KNOWN VALUE, regardless of band. Rules 3-4 test the band; this tests
  // value-presence, because on a basis-unknown saved item every band is
  // `unknown` while every value is known — the dominant saved-item state,
  // not an edge case.
  if (!concern && !benefit) {
    const fibre = bands.benefits.fibre;
    if (fibre?.hasValue) {
      benefit = {
        group: "benefit",
        nutrient: "fibre",
        band: fibre.band,
        hasValue: fibre.hasValue,
      };
    }
  }
  // Rule 5, concern half: whenever the concern slot is STILL EMPTY after rule
  // 3 — including when benefit already filled via rule 3 — backfill from
  // fixed order by value-presence. Not gated on `!benefit`: this is what lets
  // a qualifying benefit pair with a fixed-order concern fallback rather than
  // leaving the concern slot empty.
  if (!concern) {
    for (const n of CONCERN_ORDER) {
      const entry = bands.concerns[n];
      if (entry?.hasValue) {
        concern = {
          group: "concern",
          nutrient: n,
          band: entry.band,
          hasValue: entry.hasValue,
        };
        break;
      }
    }
  }

  // Benefit first whenever rule 3's concern loop never found a qualifying
  // concern (bestConcernRank never rose above its initial value), regardless
  // of which rule filled the benefit slot — including the all-unknown path,
  // where the benefit is fibre from rule 5, not rule 3.
  const out: Standout[] = [];
  if (benefit && bestConcernRank < CONCERN_RANK.medium) {
    if (benefit) out.push(benefit);
    if (concern) out.push(concern);
  } else {
    if (concern) out.push(concern);
    if (benefit) out.push(benefit);
  }
  return out;
}
