import type { NutrientKind, ScanFlag } from "@shared/types/scan-flags";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  isBeverageCategory,
} from "@shared/constants/nutrition-bands";
import {
  CAFFEINE_HIGH_MG,
  CAFFEINE_CATEGORY_TAGS,
  CAFFEINE_INGREDIENT_RE,
  CAFFEINE_FREE_RE,
  ARTIFICIAL_SWEETENER_ETAGS,
} from "./nutrition-flag-rules";

export interface UniversalNutrients {
  sugar?: number;
  saturatedFat?: number;
  sodium?: number;
  caffeine?: number;
}

export interface UniversalFlagInput {
  /** Per 100 g, or per 100 ml when isBeverage. */
  per100g: UniversalNutrients;
  /** Only when serving data is trusted. */
  perServing?: UniversalNutrients;
  servingGrams?: number;
  categoriesTags: string[];
  novaGroup?: number;
  nutriScore?: string;
  additivesTags: string[];
  ingredientsText: string | null;
}

const NUTRIENT_META = {
  sugar: {
    title: "High in sugar",
    detail: "Above the FSA guideline for sugar.",
  },
  saturated_fat: {
    title: "High in saturated fat",
    detail: "Above the FSA guideline for saturated fat.",
  },
  sodium: {
    title: "High in sodium",
    // Copy is sodium-denominated to match the id/mg display above — the
    // underlying FSA guidance is published in grams of salt and pre-converted
    // to mg sodium (see the ×400 conversion comment in
    // @shared/constants/nutrition-bands.ts).
    detail: "Above the FSA guideline for sodium.",
  },
} as const;

/**
 * The `UniversalNutrients` field each `NutrientKind` flag is computed FROM.
 *
 * Exported because the label-override POST route has to answer the MIRROR
 * question — "this nutrient flag disappeared from the label-corrected body;
 * does that body still hold a VALUE for it?" — and the only alternative is a
 * second copy of this correspondence at the call site. `saturated_fat` ->
 * `saturatedFat` is the single entry the two vocabularies do not spell alike,
 * which is exactly the entry a hand-written second copy gets wrong.
 *
 * Load-bearing for the three FSA rows rather than documentation of them:
 * `nutrientFlag` below reads its per-100/per-serving values THROUGH this map,
 * so a wrong row makes an FSA flag evaluate the wrong nutrient and fails the
 * universal-flags suite instead of drifting silently. (`caffeine` is an
 * identity row whose key and value are the same word; `satisfies` still pins
 * it to a real `UniversalNutrients` field and forces every `NutrientKind` to
 * appear.)
 */
export const NUTRIENT_FLAG_SOURCE_FIELD = {
  sugar: "sugar",
  saturated_fat: "saturatedFat",
  sodium: "sodium",
  caffeine: "caffeine",
} as const satisfies Record<NutrientKind, keyof UniversalNutrients>;

function high(
  per100g: number | undefined,
  perServing: number | undefined,
  servingGrams: number | undefined,
  per100Line: number,
  portionLine: number,
): boolean {
  if (per100g !== undefined && per100g > per100Line) return true;
  if (
    perServing !== undefined &&
    (servingGrams ?? 0) > 100 &&
    perServing > portionLine
  )
    return true;
  return false;
}

export function evaluateUniversalFlags(input: UniversalFlagInput): ScanFlag[] {
  const flags: ScanFlag[] = [];
  const drink = isBeverageCategory(input.categoriesTags);
  const per100 = drink ? FSA_DRINK : FSA_FOOD;
  const s = input.per100g;
  const sv = input.perServing;

  const nutrientFlag = (
    nk: keyof typeof NUTRIENT_META,
    line: number,
    portion: number,
  ) => {
    // Values read THROUGH the shared map, not passed in by the call site —
    // that is what keeps `NUTRIENT_FLAG_SOURCE_FIELD` honest for the route
    // that consumes it (see its docblock).
    const f = NUTRIENT_FLAG_SOURCE_FIELD[nk];
    if (high(s[f], sv?.[f], input.servingGrams, line, portion)) {
      flags.push({
        id: `nutrient:${nk}`,
        kind: "nutrient",
        severity: "warn",
        tier: "nutrition",
        title: NUTRIENT_META[nk].title,
        detail: NUTRIENT_META[nk].detail,
        nutrient: nk,
      });
    }
  };

  nutrientFlag("sugar", per100.sugar.high, FSA_PORTION.sugar);
  nutrientFlag(
    "saturated_fat",
    per100.saturatedFat.high,
    FSA_PORTION.saturatedFat,
  );
  nutrientFlag("sodium", per100.sodium.high, FSA_PORTION.sodium);

  if (input.novaGroup === 4) {
    flags.push({
      id: "processing:ultra",
      kind: "processing",
      severity: "warn",
      tier: "nutrition",
      title: "Ultra-processed",
      detail: "NOVA group 4 — made largely from industrial ingredients.",
    });
  }

  // Caffeine ladder: High mg (trusted per-serving only) → Contains (any presence signal) → none.
  const servingMg = input.perServing?.caffeine;
  const per100Mg = input.per100g.caffeine;
  // A product that explicitly declares zero caffeine, or whose ingredient text says
  // caffeine-free/decaf, is NOT a caffeine signal (would otherwise false-positive).
  const caffeineFree =
    servingMg === 0 ||
    per100Mg === 0 ||
    (input.ingredientsText != null &&
      CAFFEINE_FREE_RE.test(input.ingredientsText));
  const hasCaffeineSignal =
    !caffeineFree &&
    ((servingMg !== undefined && servingMg > 0) ||
      (per100Mg !== undefined && per100Mg > 0) ||
      (input.ingredientsText != null &&
        CAFFEINE_INGREDIENT_RE.test(input.ingredientsText)) ||
      input.categoriesTags.some((t) => CAFFEINE_CATEGORY_TAGS.includes(t)));

  if (servingMg !== undefined && servingMg >= CAFFEINE_HIGH_MG) {
    flags.push({
      id: "nutrient:caffeine",
      kind: "nutrient",
      severity: "warn",
      tier: "nutrition",
      nutrient: "caffeine",
      title: "High in caffeine",
      detail: "Contains a high dose of caffeine.",
    });
  } else if (hasCaffeineSignal) {
    flags.push({
      id: "nutrient:caffeine",
      kind: "nutrient",
      severity: "info",
      tier: "nutrition",
      nutrient: "caffeine",
      title: "Contains caffeine",
      detail: "This product contains caffeine.",
    });
  }

  if (input.additivesTags.some((t) => ARTIFICIAL_SWEETENER_ETAGS.has(t))) {
    flags.push({
      id: "sweetener:artificial",
      kind: "sweetener",
      severity: "info",
      tier: "nutrition",
      title: "Contains artificial sweeteners",
      detail: "Sweetened with one or more artificial sweeteners.",
    });
  }

  const grade = input.nutriScore;
  if (grade && ["a", "b", "c", "d", "e"].includes(grade)) {
    flags.push({
      id: `nutriscore:${grade}`,
      kind: "nutriscore",
      severity: "info",
      tier: "nutrition",
      title: `Nutri-Score ${grade.toUpperCase()}`,
      grade: grade as "a" | "b" | "c" | "d" | "e",
    });
  }

  return flags;
}
