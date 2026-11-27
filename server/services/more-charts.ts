import {
  MORE_CHART_TYPES,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";

/**
 * Removes ring, sparkline and heatmap charts (Coach roadmap T4) for an app
 * that did not say it draws them: it would drop the block, and the reply
 * would point at a chart that is not there. Its own file, not coach-blocks:
 * several tests mock that module wholesale.
 */
export function dropMoreCharts(blocks: CoachBlock[]): CoachBlock[] {
  const more: readonly string[] = MORE_CHART_TYPES;
  return blocks.filter(
    (b) => !(b.type === "inline_chart" && more.includes(b.chartType)),
  );
}
