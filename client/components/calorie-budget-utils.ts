/**
 * Pure calculation utilities for CalorieBudgetBar.
 * Extracted for testability — no React or theme dependencies.
 */

/** Remaining = calorie goal - food consumed */
export function calculateRemaining(
  calorieGoal: number,
  foodCalories: number,
): number {
  return calorieGoal - foodCalories;
}

/** Progress ratio clamped to [0, 1]. Returns 0 when calorieGoal <= 0. */
export function calculateProgress(
  foodCalories: number,
  calorieGoal: number,
): number {
  if (calorieGoal <= 0) return 0;
  return Math.min(foodCalories / calorieGoal, 1);
}
