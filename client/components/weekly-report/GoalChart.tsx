import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { WeeklyFacts } from "@shared/schemas/coach-weekly-report";
import {
  availableNutrients,
  chartSeries,
  type ChartNutrient,
} from "./weekly-report-utils";

const CHART_HEIGHT = 120;
const LABEL: Record<ChartNutrient, string> = {
  protein: "Protein",
  calories: "Calories",
  carbs: "Carbs",
};
const UNIT: Record<ChartNutrient, string> = {
  protein: "g",
  calories: "kcal",
  carbs: "g",
};
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Goal vs actual, one bar per day, a dashed goal line, chips per nutrient. */
export function GoalChart({ facts }: { facts: WeeklyFacts }) {
  const { theme } = useTheme();
  const nutrients = availableNutrients(facts);
  const [nutrient, setNutrient] = useState<ChartNutrient | undefined>(
    nutrients[0],
  );
  if (!nutrient) return null;
  const bars = chartSeries(facts, nutrient) ?? [];
  const goal = facts.goals[nutrient] ?? 0;
  const max = Math.max(goal * 1.25, ...bars.map((b) => b.value ?? 0), 1);
  const unit = UNIT[nutrient];
  const label = `${LABEL[nutrient]} by day, goal ${Math.round(goal)} ${unit}. ${bars
    .map(
      (b, i) =>
        `${DAY_NAMES[i]} ${b.value === null ? "nothing logged" : `${Math.round(b.value)} ${unit}`}`,
    )
    .join(", ")}.`;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.headerRow}>
        <ThemedText style={styles.title}>Goal vs actual</ThemedText>
        <ThemedText style={[styles.goalText, { color: theme.textSecondary }]}>
          goal {Math.round(goal)} {unit}
        </ThemedText>
      </View>
      {nutrients.length > 1 && (
        <View style={styles.chips} accessibilityRole="tablist">
          {nutrients.map((n) => {
            const selected = n === nutrient;
            return (
              <Pressable
                key={n}
                onPress={() => setNutrient(n)}
                accessibilityRole="tab"
                accessibilityLabel={LABEL[n]}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: selected
                      ? theme.accentSolid
                      : theme.surface,
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
                  {LABEL[n]}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}
      <View
        style={[styles.plot, { borderBottomColor: theme.border }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
      >
        <View
          style={[
            styles.goalLine,
            {
              bottom: (goal / max) * CHART_HEIGHT,
              borderColor: theme.textSecondary,
            },
          ]}
        />
        {bars.map((b, i) => (
          <View key={i} style={styles.barCol}>
            <View
              style={[
                styles.bar,
                {
                  height:
                    b.value === null
                      ? 2
                      : Math.max(2, (b.value / max) * CHART_HEIGHT),
                  backgroundColor: b.met
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
        {bars.map((b, i) => (
          <ThemedText
            key={i}
            style={[styles.dayLabel, { color: theme.textSecondary }]}
          >
            {b.label}
          </ThemedText>
        ))}
      </View>
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  title: { fontFamily: FontFamily.semiBold, fontSize: 15 },
  goalText: { fontSize: 12 },
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
    height: CHART_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    borderBottomWidth: 1,
  },
  goalLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
  barCol: { flex: 1, justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  labels: { flexDirection: "row", gap: Spacing.sm },
  dayLabel: { flex: 1, textAlign: "center", fontSize: 11 },
});
