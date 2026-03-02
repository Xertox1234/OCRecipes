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
