import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { WeeklyTrendPoint } from "@shared/schemas/coach-weekly-report";
import { trendSeries, type TrendMetric } from "./weekly-report-utils";

const PLOT_HEIGHT = 96;
const METRICS: {
  key: TrendMetric;
  label: string;
  max: number;
  noun: string;
}[] = [
  {
    key: "proteinDays",
    label: "Protein days",
    max: 7,
    noun: "protein days on target",
  },
  { key: "daysActive", label: "Days active", max: 7, noun: "days logged" },
  { key: "recipes", label: "Recipes", max: 0, noun: "recipes added" },
];

/** Six-week trends: one bar per week, newest in the accent. */
export function TrendsCard({
  trends,
  trendLine,
}: {
  trends: WeeklyTrendPoint[];
  trendLine: string | null;
}) {
  const { theme } = useTheme();
  const [metric, setMetric] = useState<TrendMetric>("proteinDays");
  if (trends.length < 2) return null;
  const m = METRICS.find((x) => x.key === metric) ?? METRICS[0];
  const points = trendSeries(trends, metric);
  const max = Math.max(m.max, ...points.map((p) => p.value ?? 0), 1);
  const label = `${m.label} by week: ${points
    .map((p) => `${p.label} ${p.value ?? "no data"}`)
    .join(", ")}`;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.header}>
        <ThemedText style={styles.title}>Your trends</ThemedText>
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
          last {points.length} weeks
        </ThemedText>
      </View>
      <View style={styles.chips} accessibilityRole="tablist">
        {METRICS.map((x) => {
          const selected = x.key === metric;
          return (
            <Pressable
              key={x.key}
              onPress={() => setMetric(x.key)}
              accessibilityRole="tab"
              accessibilityLabel={x.label}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: selected ? theme.accentSolid : theme.surface,
                  borderColor: selected ? theme.accentSolid : theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <ThemedText
                style={[
                  styles.chipText,
                  { color: selected ? theme.buttonText : theme.text },
                ]}
              >
                {x.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <View
        style={[styles.plot, { borderBottomColor: theme.border }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
      >
        {points.map((p, i) => (
          <View key={p.weekStart} style={styles.barCol}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(2, ((p.value ?? 0) / max) * PLOT_HEIGHT),
                  backgroundColor:
                    i === points.length - 1
                      ? theme.link
                      : theme.backgroundTertiary,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View
        style={styles.labels}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {points.map((p) => (
          <ThemedText
            key={p.weekStart}
            style={[styles.weekLabel, { color: theme.textSecondary }]}
          >
            {p.label}
          </ThemedText>
        ))}
      </View>
      {trendLine ? (
        <ThemedText style={styles.line}>{trendLine}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  title: { fontFamily: FontFamily.semiBold, fontSize: 15 },
  small: { fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  chipText: { fontFamily: FontFamily.medium, fontSize: 13 },
  plot: {
    height: PLOT_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    borderBottomWidth: 1,
  },
  barCol: { flex: 1, justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  labels: { flexDirection: "row", gap: Spacing.sm },
  weekLabel: { flex: 1, textAlign: "center", fontSize: 11 },
  line: { fontSize: 14, lineHeight: 21 },
});
