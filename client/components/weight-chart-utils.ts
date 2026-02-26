/**
 * Pure calculation utilities for WeightChart.
 * Extracted for testability — no React or react-native-svg dependencies.
 */

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
 */
export function calculateChartData(
  data: WeightEntry[],
  goalWeight: number | null | undefined,
  height: number,
): ChartData | null {
  if (data.length === 0) return null;

  const sorted = [...data]
    .sort(
      (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime(),
    )
    .slice(-30);

  const weights = sorted.map((d) => parseFloat(d.weight));
  const allValues = goalWeight ? [...weights, goalWeight] : weights;
  const minWeight = Math.min(...allValues) - 1;
  const maxWeight = Math.max(...allValues) + 1;
  const range = maxWeight - minWeight || 1;

  const padding: ChartPadding = { top: 20, right: 20, bottom: 30, left: 45 };
  const chartWidth = 320 - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points: ChartPoint[] = sorted.map((d, i) => ({
    x: padding.left + (i / Math.max(sorted.length - 1, 1)) * chartWidth,
    y:
      padding.top +
      chartHeight -
      ((parseFloat(d.weight) - minWeight) / range) * chartHeight,
    weight: parseFloat(d.weight),
    date: new Date(d.loggedAt),
  }));

  const pathData = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const goalY = goalWeight
    ? padding.top +
      chartHeight -
      ((goalWeight - minWeight) / range) * chartHeight
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
