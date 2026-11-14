/**
 * Default nutritional goals used as fallbacks when a user has no goals set.
 * Single source of truth — all services and routes should reference this constant.
 */
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fat: 67,
} as const;

/**
 * Upper bounds for one food's (or one serving's) nutrition at every boundary
 * that persists it, matching the photo-confirm and batch-scan schemas
 * (calories 50,000, macros 5,000 g). Sodium is in mg.
 */
export const NUTRITION_CAPS = {
  calories: 50_000,
  grams: 5_000,
  sodiumMg: 100_000,
  /** meal_plan_items.servings / daily_logs.servings are decimal(5,2). */
  servings: 999.99,
} as const;
