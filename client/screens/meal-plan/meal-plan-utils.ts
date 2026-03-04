import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type ItemMacros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

/**
 * Returns the meal type that should be auto-expanded based on current hour.
 * <11 → breakfast, 11-14 → lunch, 14-17 → snack, >=17 → dinner
 */
export function getAutoExpandedMealType(hour?: number): MealType {
  const h = hour ?? new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 17) return "snack";
  return "dinner";
}

/**
 * Extracts macros from a meal plan item's recipe or scannedItem, multiplied by servings.
 * Returns null for orphaned items (no recipe or scannedItem).
 */
export function computeItemMacros(
  item: MealPlanItemWithRelations,
): ItemMacros | null {
  const servings = parseFloat(item.servings || "1");
  const recipe = item.recipe;
  const scannedItem = item.scannedItem;

  if (recipe) {
    return {
      calories: Math.round(
        parseFloat(recipe.caloriesPerServing || "0") * servings,
      ),
      protein: Math.round(
        parseFloat(recipe.proteinPerServing || "0") * servings,
      ),
      carbs: Math.round(parseFloat(recipe.carbsPerServing || "0") * servings),
      fat: Math.round(parseFloat(recipe.fatPerServing || "0") * servings),
    };
  }

  if (scannedItem) {
    return {
      calories: Math.round(parseFloat(scannedItem.calories || "0") * servings),
      protein: Math.round(parseFloat(scannedItem.protein || "0") * servings),
      carbs: Math.round(parseFloat(scannedItem.carbs || "0") * servings),
      fat: Math.round(parseFloat(scannedItem.fat || "0") * servings),
    };
  }

  return null;
}

/**
 * Computes item count and total calories for a meal section (used in collapsed header).
 */
export function computeMealSectionSummary(items: MealPlanItemWithRelations[]): {
  itemCount: number;
  totalCalories: number;
} {
  let totalCalories = 0;
  for (const item of items) {
    const macros = computeItemMacros(item);
    if (macros) {
      totalCalories += macros.calories;
    }
  }
  return { itemCount: items.length, totalCalories };
}

/**
 * Formats macros into a compact string: "350 cal · 12g P · 45g C · 8g F"
 */
export function formatMacroLine(macros: ItemMacros): string {
  return `${macros.calories} cal \u00B7 ${macros.protein}g P \u00B7 ${macros.carbs}g C \u00B7 ${macros.fat}g F`;
}
