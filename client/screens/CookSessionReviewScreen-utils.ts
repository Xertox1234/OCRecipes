import type { CookSessionNutritionSummary } from "@shared/types/cook-session";

/**
 * What a screen reader hears when the cook session's nutrition total arrives
 * ("calculated") or is recalculated after a preparation change ("updated").
 * The footer card that shows it has no live region, so this is the only
 * signal that the numbers changed.
 */
export function getNutritionAnnouncement(
  total: CookSessionNutritionSummary["total"],
  kind: "calculated" | "updated",
): string {
  const lead =
    kind === "calculated" ? "Nutrition calculated" : "Nutrition updated";
  return `${lead}: ${total.calories} calories, ${total.protein} grams protein, ${total.carbs} grams carbs, ${total.fat} grams fat.`;
}
