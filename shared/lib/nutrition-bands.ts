import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION_FOOD,
  FSA_PORTION_DRINK,
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

/**
 * The per-portion RED tables, reached by `basis.scale` — the SAME discriminant
 * that picks the per-100 limits below, so the two selections cannot disagree
 * about which scale a product is on.
 *
 * Typed with a `Partial<Record<ConcernNutrient, number>>` for `lines` so that
 * indexing with `fat` is a miss (`undefined`) rather than a compile error. Both
 * tables genuinely omit `fat` — the FSA publishes the figure but no total-fat
 * flag consumes it. See the tables' own docblock.
 *
 * Note the cost of that `Partial`: adding `fat` to either table's `lines`
 * would activate a fat portion override HERE with no other edit and no
 * compile error. The predecessor's hand-written three-key projection made
 * that a compile step. The guard is now a test — "keeps both portion tables
 * red-only and fat-free" in the constants suite — not the type system.
 */
const PORTION_TABLES: Record<
  "food" | "drink",
  { triggerGrams: number; lines: Partial<Record<ConcernNutrient, number>> }
> = { food: FSA_PORTION_FOOD, drink: FSA_PORTION_DRINK };

/**
 * Classify a concern nutrient into a traffic-light band (high/medium/low).
 *
 * `portionGrams` is the weight of the WHOLE portion. It deliberately does not
 * have to be on the same scale as `perServingValue`: the portion value is
 * derived from per-100, which both caller shapes reduce to, so both work —
 *
 *   - per-portion values with `factor = 100/portionGrams` (the saved-item
 *     path): the derivation round-trips back to `perServingValue`;
 *   - already-per-100 values with `factor = 1` (the scan path): it scales up
 *     to what the portion actually holds.
 *
 * An earlier version compared `perServingValue` to the portion line directly
 * and so silently mis-judged the second shape — it read a per-100 number as
 * though it were a whole portion, which under-warns by the portion's own size
 * (11 g/100 ml of sugar in a 355 ml can reads as 11 g, not 39 g). Do not
 * reintroduce that; there is no precondition left for a caller to violate.
 *
 * The override can only ever promote TO high — it never demotes — and only for
 * portions over the scale's own trigger (100 g food, 150 ml drink).
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

  // The per-portion override can only ever promote TO high. Skipping it when
  // the weight is unknown fails toward under-warning, which is the established
  // direction for nutrient flags (allergen flags fail the other way).
  //
  // Both the table AND its trigger come off `basis.scale`, so a drink is never
  // judged against the food figures — the defect this pairing exists to
  // prevent. The portion value is derived from per-100 rather than read off
  // `perServingValue`; see the docblock for why that is what makes the
  // already-per-100 caller correct.
  const portion = PORTION_TABLES[basis.scale];
  const portionLine = portion.lines[nutrient];
  if (
    portionLine !== undefined &&
    portionGrams != null &&
    portionGrams > portion.triggerGrams &&
    (per100 * portionGrams) / 100 > portionLine
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
    // Deliberate: this branch computes an energy-share RATIO
    // (perServingValue*4 / kcalPerServing), so `basis.factor` — the per-100
    // scale — is never read for protein at all. But the `basis.kind ===
    // "unknown"` guard above still fires first, so on the dominant
    // saved-item path (basis unresolved) protein is always suppressed to
    // "unknown" even though it would be fully computable here. That
    // suppression is intentional and safe (fails toward under-warning, per
    // the project's flag-emission rule) — it is not a gap to close by
    // skipping the basis check for protein specifically.
    //
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
  /**
   * False when the nutrient has no recorded value at all (distinct from
   * zero). MUST be derived from the raw value's presence, never from
   * `band === "unknown"` — `concernBand`/`benefitBand` return `"unknown"`
   * for both an absent value AND an unresolved basis, so deriving this
   * field from the band would re-collapse exactly the two states it exists
   * to keep apart.
   */
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
  // its band, including `none` and `unknown`. This is the rule that
  // guarantees fibre is always given a promoted slot on every product.
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
    out.push(benefit);
    if (concern) out.push(concern);
  } else {
    if (concern) out.push(concern);
    if (benefit) out.push(benefit);
  }
  return out;
}
