export interface MacroTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const MACRO_META: Record<
  keyof MacroTargets,
  { label: string; unit: string; densePer: number }
> = {
  protein: { label: "protein", unit: "g", densePer: 30 },
  carbs: { label: "carbs", unit: "g", densePer: 40 },
  fat: { label: "fat", unit: "g", densePer: 15 },
  calories: { label: "calories", unit: "cal", densePer: 500 },
};

const GAP_THRESHOLD = 0.3;

/**
 * Returns an emphasis line when any macro is more than 30% short of its
 * daily target. Picks the macro with the largest gap ratio. Returns "" if
 * no macro exceeds the threshold.
 *
 * NOTE: This line is computed at prompt-build time and is intentionally NOT
 * folded into the meal-suggestion cache key — `remainingBudget` is already
 * excluded from the cache key today, and the 6h TTL bounds staleness.
 */
export function buildMacroGapEmphasis(
  targets: MacroTargets,
  remaining: MacroTargets,
): string {
  let largest: {
    key: keyof MacroTargets;
    gapAmount: number;
    ratio: number;
  } | null = null;

  for (const key of ["protein", "carbs", "fat", "calories"] as const) {
    const target = targets[key];
    // Stryker disable next-line EqualityOperator -- equivalent: target===0 makes ratio=(0-0)/0=NaN, which fails the `ratio > GAP_THRESHOLD` guard regardless, so `<= 0` and `< 0` are indistinguishable
    if (target <= 0) continue;
    const remainingClamped = Math.max(0, Math.min(target, remaining[key]));
    const ratio = (target - remainingClamped) / target;
    if (ratio > GAP_THRESHOLD) {
      const gapAmount = target - remainingClamped;
      if (!largest || ratio > largest.ratio) {
        largest = { key, gapAmount, ratio };
      }
    }
  }

  if (!largest) return "";

  const meta = MACRO_META[largest.key];
  const shortAmount = Math.round(largest.gapAmount);
  return `IMPORTANT: The user is ${shortAmount}${meta.unit} short on ${meta.label} today — prioritize ${meta.label}-dense options (≥${meta.densePer}${meta.unit} ${meta.label} per suggestion).`;
}
