/**
 * Pure calculation utilities for ProgressBar and MicronutrientBar.
 * Extracted for testability — no React dependencies.
 */

/**
 * ProgressBar percentage clamped to [0, 100].
 * Guards against zero/falsy max by treating it as 1.
 */
export function calculateProgressPercentage(
  value: number,
  max: number,
): number {
  const safeMax = max || 1;
  return Math.min((value / safeMax) * 100, 100);
}

/** Border radius is always half the bar height (pill shape). */
export function calculateBorderRadius(height: number): number {
  return height / 2;
}

/**
 * MicronutrientBar color based on percent of daily value.
 * - >= 100% → green (#2E7D32 "met goal")
 * - >= 50%  → amber (#F57F17 "halfway")
 * - < 50%   → red   (#C62828 "low")
 */
export function getMicronutrientBarColor(percentDailyValue: number): string {
  if (percentDailyValue >= 100) return "#2E7D32";
  if (percentDailyValue >= 50) return "#F57F17";
  return "#C62828";
}

/** Clamp a percentage to [0, 100]. */
export function clampPercentage(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}
