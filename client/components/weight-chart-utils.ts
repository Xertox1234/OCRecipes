/**
 * Pure calculation utilities for WeightChart.
 * Extracted for testability — no React or react-native-svg dependencies.
 */

import {
  weightFromKg,
  DEFAULT_MEASUREMENT_UNIT,
  type MeasurementUnit,
} from "@shared/lib/units";

interface WeightEntry {
  weight: string;
  loggedAt: string;
}

interface ChartPoint {
  x: number;
  y: number;
  weight: number;
  date: Date;
}

interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** SVG viewBox width — must match the viewBox in WeightChart.tsx. */
export const CHART_VIEW_WIDTH = 320;

export interface ChartData {
  points: ChartPoint[];
  pathData: string;
  goalY: number | null;
  minWeight: number;
  maxWeight: number;
  padding: ChartPadding;
  chartWidth: number;
  chartHeight: number;
}

/**
 * Calculates all chart layout data from raw weight entries.
 * Returns null when data is empty.
 *
 * Weights are stored in kg; `unit` converts every value (entries, goal, and
 * the Y-axis bounds) into the user's preferred display unit. Layout geometry
 * is unit-agnostic — only the displayed numbers differ.
 */
export function calculateChartData(
  data: WeightEntry[],
  goalWeight: number | null | undefined,
  height: number,
  unit: MeasurementUnit = DEFAULT_MEASUREMENT_UNIT,
): ChartData | null {
  if (data.length === 0) return null;

  const sorted = [...data]
    .sort(
      (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime(),
    )
    .slice(-30);

  const weights = sorted.map((d) => weightFromKg(parseFloat(d.weight), unit));
  const goalConverted =
    goalWeight != null ? weightFromKg(goalWeight, unit) : null;
  const allValues =
    goalConverted != null ? [...weights, goalConverted] : weights;
  const minWeight = Math.min(...allValues) - 1;
  const maxWeight = Math.max(...allValues) + 1;
  const range = maxWeight - minWeight || 1;

  const padding: ChartPadding = { top: 20, right: 20, bottom: 30, left: 45 };
  const chartWidth = CHART_VIEW_WIDTH - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points: ChartPoint[] = sorted.map((d, i) => {
    const weight = weights[i];
    return {
      x: padding.left + (i / Math.max(sorted.length - 1, 1)) * chartWidth,
      y:
        padding.top +
        chartHeight -
        ((weight - minWeight) / range) * chartHeight,
      weight,
      date: new Date(d.loggedAt),
    };
  });

  const pathData = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const goalY =
    goalConverted != null
      ? padding.top +
        chartHeight -
        ((goalConverted - minWeight) / range) * chartHeight
      : null;

  return {
    points,
    pathData,
    goalY,
    minWeight,
    maxWeight,
    padding,
    chartWidth,
    chartHeight,
  };
}
