import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import MicronutrientBar from "./MicronutrientBar";
import type { MicronutrientData } from "@/hooks/useMicronutrients";
import {
  classifyMicronutrients,
  countMetGoal,
  countLow,
} from "./micronutrient-summary-utils";

interface MicronutrientSummaryProps {
  micronutrients: MicronutrientData[];
  title?: string;
  showAll?: boolean;
  onShowMore?: () => void;
}

export default function MicronutrientSummary({
  micronutrients,
  title = "Micronutrients",
  showAll = false,
  onShowMore,
}: MicronutrientSummaryProps) {
  const { theme } = useTheme();

  const { vitamins, minerals } = useMemo(
    () => classifyMicronutrients(micronutrients),
    [micronutrients],
  );

  const displayVitamins = showAll ? vitamins : vitamins.slice(0, 5);
  const displayMinerals = showAll ? minerals : minerals.slice(0, 5);

  if (micronutrients.length === 0) {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.backgroundSecondary,
            borderRadius: Spacing.sm,
            padding: Spacing.md,
          },
        ]}
      >
        <Text
          style={[
            styles.title,
            { color: theme.text, fontSize: Typography.h4.fontSize },
          ]}
        >
          {title}
        </Text>
        <Text
          style={[
            styles.empty,
            { color: theme.textSecondary, marginTop: Spacing.sm },
          ]}
        >
          No micronutrient data available yet. Log some foods to see your
          vitamin and mineral intake.
        </Text>
      </View>
    );
  }

  const metGoalCount = countMetGoal(micronutrients);
  const lowCount = countLow(micronutrients);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundSecondary,
          borderRadius: Spacing.sm,
          padding: Spacing.md,
        },
      ]}
    >
      <Text
        style={[
          styles.title,
          { color: theme.text, fontSize: Typography.h4.fontSize },
        ]}
      >
        {title}
      </Text>

      <View
        style={[styles.statsRow, { marginTop: Spacing.sm, gap: Spacing.md }]}
      >
        <View style={styles.stat}>
          <Ionicons
            name="checkmark-circle"
            size={16}
            color="#2E7D32" // hardcoded — green checkmark for met-goal
          />{" "}
          <Text style={[styles.statText, { color: theme.text }]}>
            {metGoalCount} met goal
          </Text>
        </View>
        {lowCount > 0 && (
          <View style={styles.stat}>
            <Ionicons
              name="warning"
              size={16}
              color="#C62828" // hardcoded — red warning for low nutrient
            />{" "}
            <Text style={[styles.statText, { color: theme.text }]}>
              {lowCount} low
            </Text>
          </View>
        )}
      </View>

      {displayVitamins.length > 0 && (
        <View style={{ marginTop: Spacing.md }}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.textSecondary, marginBottom: Spacing.sm },
            ]}
          >
            Vitamins
          </Text>
          {displayVitamins.map((n) => (
            <MicronutrientBar
              key={n.nutrientName}
              nutrientName={n.nutrientName}
              amount={n.amount}
              unit={n.unit}
              percentDailyValue={n.percentDailyValue}
            />
          ))}
        </View>
      )}

      {displayMinerals.length > 0 && (
        <View style={{ marginTop: Spacing.md }}>
          <Text
            style={[
              styles.sectionLabel,
              { color: theme.textSecondary, marginBottom: Spacing.sm },
            ]}
          >
            Minerals
          </Text>
          {displayMinerals.map((n) => (
            <MicronutrientBar
              key={n.nutrientName}
              nutrientName={n.nutrientName}
              amount={n.amount}
              unit={n.unit}
              percentDailyValue={n.percentDailyValue}
            />
          ))}
        </View>
      )}

      {!showAll && onShowMore && micronutrients.length > 10 && (
        <Pressable
          onPress={onShowMore}
          style={[styles.showMore, { marginTop: Spacing.md }]}
          accessibilityRole="button"
          accessibilityLabel={`Show all ${micronutrients.length} nutrients`}
        >
          <Text style={{ color: theme.link, fontSize: 14, fontWeight: "500" }}>
            Show all {micronutrients.length} nutrients
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.link} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {},
  title: { fontWeight: "600" },
  statsRow: { flexDirection: "row" },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 13 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  empty: { fontSize: 14, textAlign: "center" },
  showMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
});
