import type { ScanFlag } from "@shared/types/scan-flags";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  isBeverageCategory,
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

  // Later tasks (6-8) append additional flag families here before the return.
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
  return flags;
}
