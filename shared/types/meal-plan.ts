import type { MealPlanItem, MealPlanRecipe, ScannedItem } from "@shared/schema";

export type MealPlanItemWithRelations = MealPlanItem & {
  recipe: MealPlanRecipe | null;
  scannedItem: ScannedItem | null;
};
