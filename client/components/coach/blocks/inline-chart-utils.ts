import type { InlineChart } from "@shared/schemas/coach-blocks";

/**
 * Pure helpers for the chart kinds Coach roadmap T4 added to inline_chart
 * (ring, sparkline, heatmap), so the drawing in MoreCharts.tsx stays thin and
 * Vitest covers the maths and the spoken text.
 */

type Datum = InlineChart["data"][number];

const MAX_RINGS = 4;
const MAX_HEATMAP_DAYS = 35;
const MAX_SPARKLINE_POINTS = 60;

/** "1,850", "82.4": one decimal at most, thousands grouped. */
export function chartNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function joinSpoken(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(". ");
}

function hitWords(hit: boolean | undefined, yes: string): string {
  if (hit === true) return `, ${yes}`;
  if (hit === false) return ", missed";
  return "";
}

export interface RingItem {
  label: string;
  value: number;
  target: number;
  /** 0 to 1: the share of the target reached, full at or past it. */
  progress: number;
  text: string;
  of: string;
  hit?: boolean;
}

/** One ring per value that has a target above zero, at most four. */
export function ringItems(data: Datum[]): RingItem[] {
  return data
    .filter((d): d is Datum & { target: number } => (d.target ?? 0) > 0)
    .slice(0, MAX_RINGS)
    .map((d) => ({
      label: d.label,
      value: d.value,
      target: d.target,
      progress: Math.min(Math.max(d.value / d.target, 0), 1),
      text: chartNumber(d.value),
      of: `of ${chartNumber(d.target)}`,
      hit: d.hit,
    }));
}

export function ringSpoken(
  title: string,
  items: RingItem[],
  summary: string | undefined,
): string {
  return joinSpoken([
    title,
    ...items.map(
      (i) => `${i.label}: ${i.text} ${i.of}${hitWords(i.hit, "on target")}`,
    ),
    summary,
  ]);
}

export interface SparklineGeometry {
  points: { x: number; y: number }[];
  /** The goal, from the last value that has a target. */
  target?: number;
  /** Where the goal line sits, when there is a goal. */
  targetY?: number;
  pad: number;
}

/**
 * The points a sparkline shows: the latest 60, since more would not show on
 * a phone-wide line. The line, its labels and its spoken text all use these.
 */
export function sparklineData(data: Datum[]): Datum[] {
  return data.slice(-MAX_SPARKLINE_POINTS);
}

/** The last target given, read as the goal for the whole line. */
function sparklineTarget(data: Datum[]): number | undefined {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].target !== undefined) return data[i].target;
  }
  return undefined;
}

/**
 * Point positions for a line `width` by `height`, oldest value on the left.
 * The scale spans the values and the goal, so the goal line is always on
 * the chart. Null with fewer than two points or no width yet (before
 * layout).
 */
export function sparklineGeometry(
  data: Datum[],
  width: number,
  height: number,
): SparklineGeometry | null {
  if (data.length < 2 || width <= 0 || height <= 0) return null;
  const pad = 4;
  const target = sparklineTarget(data);
  const values = data.map((d) => d.value);
  const all = target === undefined ? values : [...values, target];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min;
  const y = (v: number) =>
    span === 0 ? height / 2 : pad + ((max - v) / span) * (height - pad * 2);
  const step = (width - pad * 2) / (data.length - 1);
  return {
    points: values.map((v, i) => ({ x: pad + i * step, y: y(v) })),
    ...(target !== undefined && { target, targetY: y(target) }),
    pad,
  };
}

export function sparklineSpoken(
  title: string,
  data: Datum[],
  summary: string | undefined,
): string {
  const first = data[0];
  const last = data[data.length - 1];
  if (!first || !last) return joinSpoken([title, summary]);
  const change = last.value - first.value;
  const changeWords =
    change === 0
      ? "no change"
      : `${change > 0 ? "up" : "down"} ${chartNumber(Math.abs(change))}`;
  const target = sparklineTarget(data);
  return joinSpoken([
    title,
    `From ${chartNumber(first.value)} on ${first.label} to ${chartNumber(last.value)} on ${last.label}, ${changeWords}`,
    target === undefined ? undefined : `Goal ${chartNumber(target)}`,
    summary,
  ]);
}

export interface HeatmapCell {
  label: string;
  value: number;
  hit?: boolean;
  /** 0 to 1: the day's share of the highest value, for a day with no hit. */
  strength: number;
}

/** The last 35 days, oldest first, seven to a row when drawn. */
export function heatmapCells(data: Datum[]): HeatmapCell[] {
  const days = data.slice(-MAX_HEATMAP_DAYS);
  const max = Math.max(...days.map((d) => d.value), 0);
  return days.map((d) => ({
    label: d.label,
    value: d.value,
    hit: d.hit,
    strength: max > 0 ? Math.max(d.value, 0) / max : 0,
  }));
}

export function heatmapSpoken(
  title: string,
  cells: HeatmapCell[],
  summary: string | undefined,
): string {
  const judged = cells.filter((c) => c.hit !== undefined);
  const met = judged.filter((c) => c.hit).length;
  return joinSpoken([
    title,
    judged.length > 0 ? `${met} of ${judged.length} days met` : undefined,
    ...cells.map(
      (c) => `${c.label}: ${chartNumber(c.value)}${hitWords(c.hit, "met")}`,
    ),
    summary,
  ]);
}
