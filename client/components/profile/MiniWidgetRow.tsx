import React from "react";
import { StyleSheet, View, Pressable } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ProgressRing } from "@/components/ProgressRing";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { ProfileWidgetsResponse } from "@shared/schemas/profile-hub";

interface MiniWidgetRowProps {
  widgets: ProfileWidgetsResponse;
  onCaloriePress: () => void;
}

export const MiniWidgetRow = React.memo(function MiniWidgetRow({
  widgets,
  onCaloriePress,
}: MiniWidgetRowProps) {
  const { theme } = useTheme();
  const { dailyBudget } = widgets;

  const calorieProgress =
    dailyBudget.calorieGoal > 0
      ? dailyBudget.foodCalories / dailyBudget.calorieGoal
      : 0;

  const caloriePercent = Math.round(calorieProgress * 100);

  return (
    <View style={styles.row}>
      {/* Calorie Widget */}
      <Pressable
        onPress={onCaloriePress}
        accessibilityRole="button"
        accessibilityLabel={`Today's calories: ${dailyBudget.foodCalories} of ${dailyBudget.calorieGoal} goal, ${caloriePercent} percent complete`}
        accessibilityHint="Opens calorie details"
        style={[
          styles.widget,
          { backgroundColor: withOpacity(theme.calorieAccent, 0.06) },
        ]}
      >
        <View
          importantForAccessibility="no-hide-descendants"
          accessible={false}
        >
          <ProgressRing
            size={44}
            strokeWidth={4}
            progress={calorieProgress}
            trackColor={withOpacity(theme.calorieAccent, 0.15)}
            strokeColor={theme.calorieAccent}
          >
            <ThemedText style={[styles.ringValue, { color: theme.text }]}>
              {dailyBudget.foodCalories}
            </ThemedText>
          </ProgressRing>
          <ThemedText
            style={[styles.widgetLabel, { color: theme.textSecondary }]}
          >
            of {dailyBudget.calorieGoal} kcal
          </ThemedText>
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  widget: {
    flex: 1,
    borderRadius: BorderRadius.card,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    minHeight: 88,
    justifyContent: "center",
  },
  ringValue: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
  },
  widgetLabel: {
    fontSize: 11,
    marginTop: 2,
    textAlign: "center",
  },
});
