import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  calculateAdjustedBudget,
  calculateRemaining,
  calculateProgress,
} from "./calorie-budget-utils";

interface CalorieBudgetBarProps {
  calorieGoal: number;
  foodCalories: number;
  exerciseCalories: number;
}

export const CalorieBudgetBar = React.memo(function CalorieBudgetBar({
  calorieGoal,
  foodCalories,
  exerciseCalories,
}: CalorieBudgetBarProps) {
  const { theme } = useTheme();
  const adjustedBudget = calculateAdjustedBudget(calorieGoal, exerciseCalories);
  const remaining = calculateRemaining(adjustedBudget, foodCalories);
  const progress = calculateProgress(foodCalories, adjustedBudget);

  return (
    <View style={styles.container} accessibilityLabel="Calorie budget summary">
      <View style={styles.labelRow}>
        <View style={styles.labelItem}>
          <ThemedText style={[styles.labelValue, { color: theme.link }]}>
            {Math.round(calorieGoal)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Goal
          </ThemedText>
        </View>
        <ThemedText style={styles.operator}>-</ThemedText>
        <View style={styles.labelItem}>
          <ThemedText style={[styles.labelValue, { color: theme.error }]}>
            {Math.round(foodCalories)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Food
          </ThemedText>
        </View>
        <ThemedText style={styles.operator}>+</ThemedText>
        <View style={styles.labelItem}>
          <ThemedText style={[styles.labelValue, { color: theme.success }]}>
            {Math.round(exerciseCalories)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Exercise
          </ThemedText>
        </View>
        <ThemedText style={styles.operator}>=</ThemedText>
        <View style={styles.labelItem}>
          <ThemedText
            style={[
              styles.labelValue,
              { color: remaining >= 0 ? theme.success : theme.error },
            ]}
          >
            {Math.round(remaining)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Left
          </ThemedText>
        </View>
      </View>
      <View
        style={[
          styles.barBackground,
          { backgroundColor: withOpacity(theme.border, 0.3) },
        ]}
      >
        <View
          style={[
            styles.barFill,
            {
              width: `${progress * 100}%`,
              backgroundColor: remaining >= 0 ? theme.link : theme.error,
            },
          ]}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  labelItem: {
    alignItems: "center",
  },
  labelValue: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  operator: {
    fontSize: 16,
    fontFamily: FontFamily.regular,
    opacity: 0.5,
  },
  barBackground: {
    height: 8,
    borderRadius: BorderRadius.xs,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: BorderRadius.xs,
  },
});
