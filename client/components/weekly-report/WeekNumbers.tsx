import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { WeeklyFacts } from "@shared/schemas/coach-weekly-report";

interface Stat {
  value: string;
  suffix?: string;
  label: string;
}

/** "The week in numbers": days you showed up, meals logged, recipes added. */
export function WeekNumbers({ facts }: { facts: WeeklyFacts }) {
  const { theme } = useTheme();
  const stats: Stat[] = [
    {
      value: String(facts.daysActive),
      suffix: " of 7",
      label: "days you showed up",
    },
    { value: String(facts.mealsLogged), label: "meals logged" },
    { value: String(facts.recipesAdded), label: "recipes added" },
  ];
  return (
    <View style={styles.grid}>
      {stats.map((s) => (
        <View
          key={s.label}
          accessible
          accessibilityLabel={`${s.value}${s.suffix ?? ""} ${s.label}`}
          style={[
            styles.tile,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <ThemedText style={styles.value}>
            {s.value}
            {s.suffix && (
              <ThemedText
                style={[styles.suffix, { color: theme.textSecondary }]}
              >
                {s.suffix}
              </ThemedText>
            )}
          </ThemedText>
          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
            {s.label}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "30%",
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.md,
    gap: 2,
  },
  value: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    fontVariant: ["tabular-nums"],
  },
  suffix: { fontFamily: FontFamily.medium, fontSize: 13 },
  label: { fontSize: 12, lineHeight: 16 },
});
