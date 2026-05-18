import type { ApiWeightLog, WeightTrend } from "@shared/types/weight";
import {
  weightFromKg,
  weightUnitLabel,
  DEFAULT_MEASUREMENT_UNIT,
  type MeasurementUnit,
} from "@shared/lib/units";

export function formatWeightSubtitle(
  logs: ApiWeightLog[],
  trend: Pick<WeightTrend, "weeklyRateOfChange"> | null | undefined,
  justLogged: boolean,
  justLoggedWeight: number | undefined,
  unit: MeasurementUnit = DEFAULT_MEASUREMENT_UNIT,
): string {
  const label = weightUnitLabel(unit);
  if (justLogged && justLoggedWeight !== undefined) {
    // justLoggedWeight is the user-entered value already in `unit`.
    return `✓ Logged ${justLoggedWeight.toFixed(1)} ${label}`;
  }
  if (logs.length === 0) {
    return "Log your first weight";
  }
  const last = weightFromKg(parseFloat(logs[0].weight), unit);
  const rate = trend?.weeklyRateOfChange;
  if (rate != null && rate !== 0) {
    const delta = formatWeightDelta(rate, unit);
    return `${last.toFixed(1)} ${label} · ${delta} ${label}/wk`;
  }
  return `${last.toFixed(1)} ${label}`;
}

export function formatWeightDelta(
  weeklyRate: number | null | undefined,
  unit: MeasurementUnit = DEFAULT_MEASUREMENT_UNIT,
): string {
  if (weeklyRate == null || weeklyRate === 0) return "—";
  const abs = Math.abs(weightFromKg(weeklyRate, unit)).toFixed(1);
  return weeklyRate < 0 ? `▼ ${abs}` : `▲ ${abs}`;
}

export function computeGoalProgress(
  currentWeight: number | null | undefined,
  goalWeight: number | null | undefined,
  startWeight: number | null | undefined,
): number {
  if (currentWeight == null || goalWeight == null || startWeight == null) {
    return 0;
  }
  const range = startWeight - goalWeight;
  if (range === 0) return 0;
  const made = startWeight - currentWeight;
  return Math.min(1, Math.max(0, made / range));
}

export function formatGoalLabel(
  currentWeight: number,
  goalWeight: number,
  unit: MeasurementUnit = DEFAULT_MEASUREMENT_UNIT,
): string {
  // currentWeight and goalWeight are kg; the difference is converted for display.
  const remainingKg = Math.abs(currentWeight - goalWeight);
  if (remainingKg < 0.05) return "Goal reached!";
  return `${weightFromKg(remainingKg, unit).toFixed(1)} ${weightUnitLabel(unit)} to goal`;
}
