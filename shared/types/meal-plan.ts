import type { MealPlanItem, MealPlanRecipe, ScannedItem } from "@shared/schema";
import type { MealPlanDay } from "@shared/schemas/coach-blocks";

export type { MealPlanDay };

export type MealPlanItemWithRelations = MealPlanItem & {
  recipe: MealPlanRecipe | null;
  scannedItem: ScannedItem | null;
};
