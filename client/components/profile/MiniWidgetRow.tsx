import React, { useState, useEffect } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

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
  onFastingPress: () => void;
}

export const MiniWidgetRow = React.memo(function MiniWidgetRow({
  widgets,
  onCaloriePress,
  onFastingPress,
}: MiniWidgetRowProps) {
  const { theme } = useTheme();
  const { dailyBudget, fasting } = widgets;

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

      {/* Fasting Widget */}
      <FastingWidget fasting={fasting} onPress={onFastingPress} />
    </View>
  );
});

const FastingWidget = React.memo(function FastingWidget({
  fasting,
  onPress,
}: {
  fasting: ProfileWidgetsResponse["fasting"];
  onPress: () => void;
}) {
  const { theme } = useTheme();

  // Tick every 60s while fasting to keep elapsed time fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!fasting.currentFast) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [fasting.currentFast]);

  const fastingLabel = getFastingLabel(fasting);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Fasting: ${fastingLabel}`}
      accessibilityHint="Opens fasting details"
      style={[
        styles.widget,
        { backgroundColor: withOpacity(theme.link, 0.06) },
      ]}
    >
      <View importantForAccessibility="no-hide-descendants" accessible={false}>
        <Feather
          name="clock"
          size={22}
          color={fasting.currentFast ? theme.link : theme.textSecondary}
        />
        <ThemedText
          style={[
            styles.widgetValue,
            { color: fasting.currentFast ? theme.link : theme.textSecondary },
          ]}
        >
          {getFastingTime(fasting)}
        </ThemedText>
        <ThemedText
          style={[styles.widgetLabel, { color: theme.textSecondary }]}
        >
          {fasting.currentFast
            ? "Fasting"
            : fasting.schedule
              ? "Eating"
              : "Set up"}
        </ThemedText>
      </View>
    </Pressable>
  );
});

function getFastingLabel(fasting: ProfileWidgetsResponse["fasting"]): string {
  if (fasting.currentFast) {
    const elapsed = getElapsedHours(fasting.currentFast.startedAt);
    return `${elapsed} hours elapsed of ${fasting.currentFast.targetDurationHours} hour fast. Tap to view fasting details`;
  }
  if (fasting.schedule) {
    return "In eating window. Tap to view fasting details";
  }
  return "No fasting schedule. Tap to set up";
}

function getFastingTime(fasting: ProfileWidgetsResponse["fasting"]): string {
  if (fasting.currentFast) {
    const elapsed = getElapsedHours(fasting.currentFast.startedAt);
    const hours = Math.floor(elapsed);
    const minutes = Math.floor((elapsed - hours) * 60);
    return `${hours}h ${minutes}m`;
  }
  return "00:00";
}

function getElapsedHours(startedAt: string): number {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  return (now - start) / (1000 * 60 * 60);
}

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
  widgetValue: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    marginTop: Spacing.xs,
  },
  widgetLabel: {
    fontSize: 11,
    marginTop: 2,
    textAlign: "center",
  },
});
