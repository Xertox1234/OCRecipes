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
    // The `<= 0` guard's EqualityOperator mutants: `<= 0`->`< 0` is EQUIVALENT (target===0
    // makes ratio=(0-0)/0=NaN, which fails the `ratio > GAP_THRESHOLD` guard regardless), and
    // `<= 0`->`>= 0` is already killed by every emphasis-expecting test (`>= 0` skips all
    // positive targets → always ""). Stryker has no per-replacement granularity, so disabling
    // the family drops only the one unkillable equivalent — no killable mutant is hidden.
    // (Directive must sit on the line directly above the statement it suppresses.)
    // Stryker disable next-line EqualityOperator -- equivalent `<= 0`->`< 0` (NaN-masked)
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
