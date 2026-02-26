/**
 * Pure calculation utilities for CalorieBudgetBar.
 * Extracted for testability — no React or theme dependencies.
 */

/** Adjusted budget = base goal + exercise calories burned */
export function calculateAdjustedBudget(
  calorieGoal: number,
  exerciseCalories: number,
): number {
  return calorieGoal + exerciseCalories;
}

/** Remaining = adjusted budget - food consumed */
export function calculateRemaining(
  adjustedBudget: number,
  foodCalories: number,
): number {
  return adjustedBudget - foodCalories;
}

/** Progress ratio clamped to [0, 1]. Returns 0 when adjustedBudget <= 0. */
export function calculateProgress(
  foodCalories: number,
  adjustedBudget: number,
): number {
  if (adjustedBudget <= 0) return 0;
  return Math.min(foodCalories / adjustedBudget, 1);
}
