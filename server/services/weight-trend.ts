import type { WeightTrend } from "@shared/types/weight";

/**
 * WeightTrendResult is the server-side alias for the shared WeightTrend type.
 * It omits `goalWeight` because that is added by the route handler, not the
 * trend calculation function itself.
 */
export type WeightTrendResult = Omit<WeightTrend, "goalWeight">;

interface WeightEntry {
  weight: string;
  loggedAt: Date;
}

function movingAverage(entries: WeightEntry[], days: number): number | null {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const inRange = entries.filter((e) => e.loggedAt >= cutoff);
  if (inRange.length === 0) return null;
  const sum = inRange.reduce((acc, e) => acc + parseFloat(e.weight), 0);
  return Math.round((sum / inRange.length) * 100) / 100;
}

export function calculateWeightTrend(
  logs: WeightEntry[],
  goalWeight?: number | null,
): WeightTrendResult {
  if (logs.length === 0) {
    return {
      avg7Day: null,
      avg30Day: null,
      weeklyRateOfChange: null,
      projectedGoalDate: null,
      currentWeight: null,
      entries: 0,
    };
  }

  const sorted = [...logs].sort(
    (a, b) => b.loggedAt.getTime() - a.loggedAt.getTime(),
  );
  const currentWeight = parseFloat(sorted[0].weight);
  const avg7Day = movingAverage(sorted, 7);
  const avg30Day = movingAverage(sorted, 30);

  // Weekly rate of change: compare avg of last 7 days vs avg of 7 days before that
  let weeklyRateOfChange: number | null = null;
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const thisWeek = sorted.filter((e) => e.loggedAt >= oneWeekAgo);
  const lastWeek = sorted.filter(
    (e) => e.loggedAt >= twoWeeksAgo && e.loggedAt < oneWeekAgo,
  );

  if (thisWeek.length > 0 && lastWeek.length > 0) {
    const thisAvg =
      thisWeek.reduce((sum, e) => sum + parseFloat(e.weight), 0) /
      thisWeek.length;
    const lastAvg =
      lastWeek.reduce((sum, e) => sum + parseFloat(e.weight), 0) /
      lastWeek.length;
    weeklyRateOfChange = Math.round((thisAvg - lastAvg) * 100) / 100;
  }

  // Projected goal date
  let projectedGoalDate: string | null = null;
  if (goalWeight && weeklyRateOfChange && weeklyRateOfChange !== 0) {
    const diff = goalWeight - currentWeight;
    // Rate must be in right direction
    if (
      (diff < 0 && weeklyRateOfChange < 0) ||
      (diff > 0 && weeklyRateOfChange > 0)
    ) {
      const weeksToGoal = Math.abs(diff / weeklyRateOfChange);
      const goalDate = new Date();
      goalDate.setDate(goalDate.getDate() + Math.round(weeksToGoal * 7));
      projectedGoalDate = goalDate.toISOString().split("T")[0];
    }
  }

  return {
    avg7Day,
    avg30Day,
    weeklyRateOfChange,
    projectedGoalDate,
    currentWeight,
    entries: sorted.length,
  };
}
