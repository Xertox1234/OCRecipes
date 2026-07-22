import type { ScanFlag } from "@shared/types/scan-flags";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  isBeverageCategory,
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
    detail: "Above the FSA guideline for salt.",
  },
} as const;

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
    key: keyof typeof NUTRIENT_META,
    nk: "sugar" | "saturated_fat" | "sodium",
    p100: number | undefined,
    pServ: number | undefined,
    line: number,
    portion: number,
  ) => {
    if (high(p100, pServ, input.servingGrams, line, portion)) {
      flags.push({
        id: `nutrient:${nk}`,
        kind: "nutrient",
        severity: "warn",
        tier: "nutrition",
        title: NUTRIENT_META[key].title,
        detail: NUTRIENT_META[key].detail,
        nutrient: nk,
      });
    }
  };

  nutrientFlag(
    "sugar",
    "sugar",
    s.sugar,
    sv?.sugar,
    per100.sugar,
    FSA_PORTION.sugar,
  );
  nutrientFlag(
    "saturated_fat",
    "saturated_fat",
    s.saturatedFat,
    sv?.saturatedFat,
    per100.saturatedFat,
    FSA_PORTION.saturatedFat,
  );
  nutrientFlag(
    "sodium",
    "sodium",
    s.sodium,
    sv?.sodium,
    per100.sodium,
    FSA_PORTION.sodium,
  );

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
      value: { amount: Math.round(servingMg), unit: "mg" },
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
