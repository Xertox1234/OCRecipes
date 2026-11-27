import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";
import { ProgressRing } from "@/components/ProgressRing";
import type { InlineChart } from "@shared/schemas/coach-blocks";
import {
  chartNumber,
  heatmapCells,
  heatmapSpoken,
  ringItems,
  ringSpoken,
  sparklineData,
  sparklineGeometry,
  sparklineSpoken,
} from "./inline-chart-utils";

/**
 * The chart kinds Coach roadmap T4 added to inline_chart: ring, sparkline
 * and heatmap. Each card is one accessible node that speaks every value, as
 * the bar chart does; the maths lives in inline-chart-utils.ts.
 */

interface Props {
  block: InlineChart;
}

function Card({
  label,
  title,
  summary,
  children,
}: {
  label: string;
  title: string;
  summary?: string;
  children?: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessible={true}
      accessibilityLabel={label}
    >
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {children}
      {summary ? (
        <Text style={[styles.summary, { color: theme.textSecondary }]}>
          {summary}
        </Text>
      ) : null}
    </View>
  );
}

export const RingChart = React.memo(function RingChart({ block }: Props) {
  const { theme } = useTheme();
  const items = ringItems(block.data);
  return (
    <Card
      label={ringSpoken(block.title, items, block.summary)}
      title={block.title}
      summary={block.summary}
    >
      <View style={styles.ringRow}>
        {items.map((item, i) => (
          <View key={i} style={styles.ringCol} testID="inline-chart-ring">
            <ProgressRing
              size={56}
              strokeWidth={6}
              progress={item.progress}
              trackColor={withOpacity(theme.textSecondary, 0.25)}
              // Green and red only with the mark beside the label; a ring
              // with no verdict is neutral, so colour never says "on target"
              // by itself.
              strokeColor={
                item.hit === true
                  ? theme.success
                  : item.hit === false
                    ? theme.error
                    : theme.link
              }
            >
              <Text
                style={[styles.ringValue, { color: theme.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.2}
              >
                {item.text}
              </Text>
            </ProgressRing>
            {/* The mark beside the label, so met and missed do not rest on
                the ring's colour alone. */}
            <Text
              style={[styles.ringLabel, { color: theme.text }]}
              numberOfLines={2}
              maxFontSizeMultiplier={1.2}
            >
              {item.hit === true
                ? `${item.label} ✓`
                : item.hit === false
                  ? `${item.label} ✗`
                  : item.label}
            </Text>
            <Text
              style={[styles.ringOf, { color: theme.textSecondary }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {item.of}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
});

/** The line is drawn in this box and stretched to the card's width. */
const SPARK_W = 300;
const SPARK_H = 56;

export const SparklineChart = React.memo(function SparklineChart({
  block,
}: Props) {
  const { theme } = useTheme();
  const data = sparklineData(block.data);
  const geometry = sparklineGeometry(data, SPARK_W, SPARK_H);
  const first = data[0];
  const last = data[data.length - 1];
  return (
    <Card
      label={sparklineSpoken(block.title, data, block.summary)}
      title={block.title}
      summary={block.summary}
    >
      {geometry && first && last ? (
        <>
          {/* A fixed viewBox stretched to the width; non-scaling strokes
              keep the line's weight when it is stretched. */}
          <Svg
            width="100%"
            height={SPARK_H}
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
          >
            {geometry.targetY !== undefined ? (
              <Line
                x1={geometry.pad}
                x2={SPARK_W - geometry.pad}
                y1={geometry.targetY}
                y2={geometry.targetY}
                stroke={theme.textSecondary}
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <Polyline
              points={geometry.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={theme.link}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </Svg>
          <View style={styles.sparkLabels}>
            <Text
              style={[styles.edgeLabel, { color: theme.textSecondary }]}
              maxFontSizeMultiplier={1.2}
            >
              {first.label}
            </Text>
            <Text
              style={[styles.edgeLabel, { color: theme.text }]}
              maxFontSizeMultiplier={1.2}
            >
              {geometry.target === undefined
                ? `${last.label} · ${chartNumber(last.value)}`
                : `${last.label} · ${chartNumber(last.value)} · goal ${chartNumber(geometry.target)}`}
            </Text>
          </View>
        </>
      ) : null}
    </Card>
  );
});

export const HeatmapChart = React.memo(function HeatmapChart({ block }: Props) {
  const { theme } = useTheme();
  const cells = heatmapCells(block.data);
  const first = cells[0];
  const last = cells[cells.length - 1];
  return (
    <Card
      label={heatmapSpoken(block.title, cells, block.summary)}
      title={block.title}
      summary={block.summary}
    >
      <View style={styles.grid}>
        {cells.map((cell, i) => (
          <View
            key={i}
            testID="inline-chart-cell"
            style={[
              styles.cell,
              {
                backgroundColor:
                  cell.hit === true
                    ? theme.successSolid
                    : cell.hit === false
                      ? theme.backgroundSecondary
                      : withOpacity(theme.link, 0.15 + 0.85 * cell.strength),
              },
              // A missed day is outlined and marked, so it neither vanishes
              // into the card nor looks like a low day with no verdict.
              cell.hit === false && {
                borderWidth: 1,
                borderColor: theme.textSecondary,
              },
            ]}
          >
            {cell.hit !== undefined ? (
              <Text
                style={[
                  styles.cellMark,
                  { color: cell.hit ? theme.buttonText : theme.text },
                ]}
                maxFontSizeMultiplier={1.2}
              >
                {cell.hit ? "✓" : "✗"}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {first && last ? (
        <View style={styles.sparkLabels}>
          <Text
            style={[styles.edgeLabel, { color: theme.textSecondary }]}
            maxFontSizeMultiplier={1.2}
          >
            {first.label}
          </Text>
          {last !== first ? (
            <Text
              style={[styles.edgeLabel, { color: theme.textSecondary }]}
              maxFontSizeMultiplier={1.2}
            >
              {last.label}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  title: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  summary: { fontSize: 11, marginTop: 8, textAlign: "center" },
  ringRow: { flexDirection: "row", justifyContent: "space-around" },
  ringCol: { alignItems: "center", flex: 1 },
  ringValue: { fontSize: 12, fontWeight: "700", paddingHorizontal: 6 },
  ringLabel: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  ringOf: { fontSize: 10, marginTop: 1 },
  sparkLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  edgeLabel: { fontSize: 10 },
  // Seven to a row: a cell is a little under a seventh of the width.
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cell: {
    width: "12.5%",
    aspectRatio: 1,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  cellMark: { fontSize: 12, fontWeight: "700" },
});
