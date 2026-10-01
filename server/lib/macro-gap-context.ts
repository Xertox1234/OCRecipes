export interface MacroTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

// Calories are not a candidate: they are the day-progress reference the
// macros are measured against, and a "calorie-dense" push is never the fix.
const MACRO_META: Record<
  "protein" | "carbs" | "fat",
  { label: string; unit: string; densePer: number }
> = {
  protein: { label: "protein", unit: "g", densePer: 30 },
  carbs: { label: "carbs", unit: "g", densePer: 40 },
  fat: { label: "fat", unit: "g", densePer: 15 },
};

const LAG_THRESHOLD = 0.3;

/** What is still left of `target`, clamped to 0..target. */
function stillLeft(target: number, remaining: number): number {
  return Math.max(0, Math.min(target, remaining));
}

/** Share of `target` already eaten (0..1). */
function eatenShare(target: number, remaining: number): number {
  return (target - stillLeft(target, remaining)) / target;
}

/**
 * Returns an emphasis line when a macro lags the day's calories: the user has
 * eaten a share of it more than 30 percentage points below the share of their
 * calories eaten (half the calories but a fifth of the protein, say). Picks the
 * macro that lags most and reports how much of it is still left. Returns "" when
 * nothing lags — including before anything has been eaten, when every share is 0.
 *
 * `remaining` is the remaining budget (target − consumed), as the route
 * computes it — not the amount consumed.
 *
 * NOTE: This line is computed at prompt-build time and is intentionally NOT
 * folded into the meal-suggestion cache key — `remainingBudget` is already
 * excluded from the cache key today, and the 6h TTL bounds staleness.
 */
export function buildMacroGapEmphasis(
  targets: MacroTargets,
  remaining: MacroTargets,
): string {
  // A non-positive calorie target leaves no day progress to compare against.
  // `<= 0`->`< 0` is EQUIVALENT: a 0 target makes every lag NaN, which fails the
  // `lag > LAG_THRESHOLD` guard regardless. (Directive must sit on the line
  // directly above the statement it suppresses.)
  // Stryker disable next-line EqualityOperator -- equivalent `<= 0`->`< 0` (NaN-masked)
  if (targets.calories <= 0) return "";
  const dayShare = eatenShare(targets.calories, remaining.calories);

  let largest: { key: keyof typeof MACRO_META; lag: number } | null = null;

  // A zero or negative macro target never lags: 0 gives a NaN share, and a
  // negative one clamps to "all eaten" (share 1), so no guard is needed.
  for (const key of ["protein", "carbs", "fat"] as const) {
    const lag = dayShare - eatenShare(targets[key], remaining[key]);
    if (lag > LAG_THRESHOLD && (!largest || lag > largest.lag)) {
      largest = { key, lag };
    }
  }

  if (!largest) return "";

  const meta = MACRO_META[largest.key];
  const amount = Math.round(
    stillLeft(targets[largest.key], remaining[largest.key]),
  );
  return `IMPORTANT: The user is ${amount}${meta.unit} short on ${meta.label} today — prioritize ${meta.label}-dense options (≥${meta.densePer}${meta.unit} ${meta.label} per suggestion).`;
}
