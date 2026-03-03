import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path, Circle, Line, Text as SvgText } from "react-native-svg";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { calculateChartData, CHART_VIEW_WIDTH } from "./weight-chart-utils";

interface WeightChartProps {
  data: { weight: string; loggedAt: string }[];
  goalWeight?: number | null;
  height?: number;
}

export const WeightChart = React.memo(function WeightChart({
  data,
  goalWeight,
  height = 200,
}: WeightChartProps) {
  const { theme } = useTheme();

  const chartData = useMemo(
    () => calculateChartData(data, goalWeight, height),
    [data, goalWeight, height],
  );

  if (!chartData || chartData.points.length === 0) {
    return (
      <View style={[styles.emptyContainer, { height }]}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Log your weight to see trends
        </ThemedText>
      </View>
    );
  }

  const { points, pathData, goalY, minWeight, maxWeight, padding } = chartData;

  const latestWeight = points.length > 0 ? data[data.length - 1]?.weight : null;

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={`Weight chart showing ${points.length} entries${latestWeight ? `, latest: ${latestWeight} kg` : ""}`}
    >
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${CHART_VIEW_WIDTH} ${height}`}
      >
        {/* Y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const val = minWeight + (maxWeight - minWeight) * (1 - frac);
          const y =
            padding.top + (height - padding.top - padding.bottom) * frac;
          return (
            <React.Fragment key={frac}>
              <Line
                x1={padding.left}
                y1={y}
                x2={CHART_VIEW_WIDTH - padding.right}
                y2={y}
                stroke={theme.border}
                strokeWidth={0.5}
              />
              <SvgText
                x={padding.left - 5}
                y={y + 4}
                fontSize={10}
                fill={theme.textSecondary}
                textAnchor="end"
              >
                {val.toFixed(1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Goal weight line */}
        {goalY != null && (
          <>
            <Line
              x1={padding.left}
              y1={goalY}
              x2={CHART_VIEW_WIDTH - padding.right}
              y2={goalY}
              stroke={theme.success}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <SvgText
              x={CHART_VIEW_WIDTH - padding.right + 2}
              y={goalY + 4}
              fontSize={9}
              fill={theme.success}
              textAnchor="start"
            >
              Goal
            </SvgText>
          </>
        )}

        {/* Weight line */}
        <Path
          d={pathData}
          fill="none"
          stroke={theme.link}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={theme.link} />
        ))}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  emptyContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
});
