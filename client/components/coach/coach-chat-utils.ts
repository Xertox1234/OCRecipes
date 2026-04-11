import {
  mealPlanCardSchema,
  type MealPlanDay,
} from "@shared/schemas/coach-blocks";

/**
 * Validates and parses raw plan data from a block action into typed MealPlanDay[].
 * Returns undefined if the data is missing or fails Zod validation.
 */
export function parsePlanDays(raw: unknown): MealPlanDay[] | undefined {
  const parsed = mealPlanCardSchema.shape.days.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Builds an accessibility label for the AI meal plan banner.
 */
export function planBannerA11yLabel(days: MealPlanDay[]): string {
  const totalMeals = days.reduce((sum, d) => sum + d.meals.length, 0);
  const dayWord = days.length === 1 ? "day" : "days";
  const mealWord = totalMeals === 1 ? "meal" : "meals";
  return `AI meal plan with ${days.length} ${dayWord} and ${totalMeals} ${mealWord}`;
}
