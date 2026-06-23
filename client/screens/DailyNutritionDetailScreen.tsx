import React, { useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Text,
  Platform,
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { CalorieRing } from "@/components/CalorieRing";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useDailyBudget } from "@/hooks/useDailyBudget";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import type { DailySummaryResponse, GoalsResponse } from "@/types/api";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

type AppTheme = (typeof Colors)["light"];

interface MacroInfo {
  label: string;
  current: number;
  goal: number;
  colorKey: "proteinAccent" | "carbsAccent" | "fatAccent";
}

function MacroProgressBar({
  macro,
  theme,
  reducedMotion,
}: {
  macro: MacroInfo;
  theme: AppTheme;
  reducedMotion: boolean;
}) {
  const progress =
    macro.goal > 0 ? Math.min(Math.max(macro.current / macro.goal, 0), 1) : 0;
  const accentColor = theme[macro.colorKey];

  const animatedWidth = useSharedValue(0);
  React.useEffect(() => {
    animatedWidth.value = reducedMotion
      ? progress
      : withTiming(progress, {
          duration: 800,
          easing: Easing.out(Easing.cubic),
        });
  }, [progress, reducedMotion, animatedWidth]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${animatedWidth.value * 100}%`,
  }));

  return (
    <View
      style={styles.macroRow}
      accessibilityRole="progressbar"
      accessibilityLabel={`${macro.label}: ${macro.current} grams of ${macro.goal} gram goal`}
      accessibilityValue={{
        min: 0,
        max: macro.goal,
        now: macro.current,
        text: `${macro.current}g of ${macro.goal}g`,
      }}
    >
      <View style={styles.macroHeader}>
        <ThemedText style={[styles.macroLabel, { color: accentColor }]}>
          {macro.label}
        </ThemedText>
        <ThemedText
          style={[styles.macroValues, { color: theme.textSecondary }]}
        >
          {macro.current}g / {macro.goal}g
        </ThemedText>
      </View>
      <View
        style={[
          styles.progressTrack,
          { backgroundColor: withOpacity(theme.border, 0.3) },
        ]}
      >
        <Animated.View
          style={[
            styles.progressFill,
            { backgroundColor: accentColor },
            fillStyle,
          ]}
        />
      </View>
    </View>
  );
}

export default function DailyNutritionDetailScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  const {
    data: budget,
    isLoading: budgetLoading,
    isError: budgetError,
    refetch: refetchBudget,
  } = useDailyBudget(undefined, { meta: { silentError: true } });
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery<DailySummaryResponse>({
    queryKey: ["/api/daily-summary"],
    // Custom queryFn (not the global getQueryFn) so the device timezone is sent
    // as X-Timezone — without it, non-UTC users get UTC-bucketed day summaries.
    // Key stays the bare ["/api/daily-summary"] (no { tz } segment) to keep the
    // cache entry shared with useHistoryData, which sends the same header.
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/daily-summary", undefined, {
        headers: { "X-Timezone": getDeviceTimezone() },
      });
      return res.json() as Promise<DailySummaryResponse>;
    },
    // No silentError here: this key is shared with useHistoryData (History
    // dashboard, no own error UI), so opting out could suppress its global-toast
    // backstop. This screen's error gate (summaryError, below) still catches it.
  });
  const {
    data: goals,
    isLoading: goalsLoading,
    isError: goalsError,
    refetch: refetchGoals,
  } = useQuery<GoalsResponse>({
    queryKey: ["/api/goals"],
    meta: { silentError: true },
  });
  const isLoading = budgetLoading || summaryLoading || goalsLoading;
  const isError = budgetError || summaryError || goalsError;

  const handleRetry = React.useCallback(() => {
    void Promise.all([refetchBudget(), refetchSummary(), refetchGoals()]);
  }, [refetchBudget, refetchSummary, refetchGoals]);

  // iOS pairs with the Android `accessibilityLiveRegion` on the error text;
  // gating to iOS avoids a double-announce on Android (live region + announce).
  useEffect(() => {
    if (isError && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        "Unable to load nutrition data. Double tap retry to try again.",
      );
    }
  }, [isError]);

  const consumed = summary?.totalCalories ?? 0;
  const calorieGoal = budget?.calorieGoal ?? goals?.calories ?? 0;
  const remaining = budget?.remaining ?? calorieGoal - consumed;
  const protein = summary?.totalProtein ?? 0;
  const carbs = summary?.totalCarbs ?? 0;
  const fat = summary?.totalFat ?? 0;
  const itemCount = summary?.itemCount ?? 0;

  const proteinGoal = goals?.protein ?? 0;
  const carbsGoal = goals?.carbs ?? 0;
  const fatGoal = goals?.fat ?? 0;

  const macros: MacroInfo[] = useMemo(
    () => [
      {
        label: "Protein",
        current: protein,
        goal: proteinGoal,
        colorKey: "proteinAccent",
      },
      {
        label: "Carbs",
        current: carbs,
        goal: carbsGoal,
        colorKey: "carbsAccent",
      },
      { label: "Fat", current: fat, goal: fatGoal, colorKey: "fatAccent" },
    ],
    [protein, proteinGoal, carbs, carbsGoal, fat, fatGoal],
  );

  const contentContainerStyle = useMemo(
    () => ({ paddingBottom: insets.bottom + Spacing.xl }),
    [insets.bottom],
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: theme.backgroundRoot },
        ]}
        accessibilityViewIsModal
      >
        <ActivityIndicator
          size="large"
          color={theme.link}
          accessibilityLabel="Loading nutrition data"
        />
      </View>
    );
  }

  // Error gate runs BEFORE the zero-defaulting render below so a failed
  // /api/daily-summary never presents "0 consumed / 0 items logged" as real
  // data. Genuinely-empty (200 with no items today) falls through to the
  // normal render where 0 is a legitimate value.
  if (isError) {
    return (
      <View
        style={[
          styles.errorContainer,
          { backgroundColor: theme.backgroundRoot },
        ]}
        accessibilityViewIsModal
      >
        <Feather
          name="alert-circle"
          size={40}
          color={theme.textSecondary}
          accessible={false}
        />
        <Text
          style={[styles.errorTitle, { color: theme.text }]}
          accessibilityLiveRegion="assertive"
        >
          Unable to load nutrition data
        </Text>
        <Text style={[styles.errorMessage, { color: theme.textSecondary }]}>
          Check your connection and try again.
        </Text>
        <Pressable
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading nutrition data"
          style={({ pressed }) => [
            styles.retryButton,
            { backgroundColor: theme.accentSolid, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Feather
            name="refresh-cw"
            size={16}
            color={theme.buttonText}
            accessible={false}
          />
          <Text style={[styles.retryText, { color: theme.buttonText }]}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  const entering = reducedMotion ? undefined : FadeInDown.duration(400);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={contentContainerStyle}
      accessibilityViewIsModal
    >
      {/* CalorieRing hero section */}
      <View style={styles.ringSection}>
        <CalorieRing
          consumed={consumed}
          goal={calorieGoal}
          protein={protein}
          carbs={carbs}
          fat={fat}
        />
      </View>

      {/* Remaining calories card */}
      <Animated.View entering={entering}>
        <Card style={styles.remainingCard}>
          <ThemedText
            type="h4"
            accessibilityLabel={`${remaining} calories remaining`}
          >
            {remaining.toLocaleString()} calories remaining
          </ThemedText>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary }}
            accessibilityLabel={`${itemCount} ${itemCount === 1 ? "item" : "items"} logged today`}
          >
            {itemCount} {itemCount === 1 ? "item" : "items"} logged today
          </ThemedText>
        </Card>
      </Animated.View>

      {/* Macro detail section */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.duration(400).delay(100)
        }
        style={styles.macroSection}
      >
        <ThemedText type="h4" style={styles.macroSectionTitle}>
          Macro Breakdown
        </ThemedText>
        {macros.map((macro) => (
          <MacroProgressBar
            key={macro.label}
            macro={macro}
            theme={theme}
            reducedMotion={reducedMotion}
          />
        ))}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  errorTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  errorMessage: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    textAlign: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.button,
    minHeight: 44,
  },
  retryText: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  ringSection: {
    paddingTop: Spacing.xl * 2 + 40,
    paddingBottom: Spacing.sm,
    alignItems: "center",
  },
  remainingCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  macroSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  macroSectionTitle: {
    marginBottom: Spacing.md,
  },
  macroRow: {
    marginBottom: Spacing.md,
  },
  macroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  macroLabel: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  macroValues: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  progressTrack: {
    height: 8,
    borderRadius: BorderRadius.xs / 2,
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    borderRadius: BorderRadius.xs / 2,
  },
});
