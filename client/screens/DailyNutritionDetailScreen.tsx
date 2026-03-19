import React from "react";
import { StyleSheet, View, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Animated, { FadeInDown } from "react-native-reanimated";

import { CalorieRing } from "@/components/CalorieRing";
import { AdaptiveGoalCard } from "@/components/AdaptiveGoalCard";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useDailyBudget } from "@/hooks/useDailyBudget";
import { useAdaptiveGoals } from "@/hooks/useAdaptiveGoals";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface DailySummaryResponse {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  itemCount: number;
}

interface GoalsResponse {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface MacroInfo {
  label: string;
  current: number;
  goal: number;
  colorKey: "proteinAccent" | "carbsAccent" | "fatAccent";
}

export default function DailyNutritionDetailScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { isPremium } = usePremiumContext();

  const { data: budget, isLoading: budgetLoading } = useDailyBudget();
  const { data: summary, isLoading: summaryLoading } =
    useQuery<DailySummaryResponse>({
      queryKey: ["/api/daily-summary"],
    });
  const { data: goals, isLoading: goalsLoading } = useQuery<GoalsResponse>({
    queryKey: ["/api/goals"],
  });
  const { data: adaptiveGoalData } = useAdaptiveGoals(isPremium);

  const isLoading = budgetLoading || summaryLoading || goalsLoading;

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

  const macros: MacroInfo[] = [
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
  ];

  if (isLoading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: theme.backgroundRoot },
        ]}
      >
        <ActivityIndicator
          size="large"
          color={theme.link}
          accessibilityLabel="Loading nutrition data"
        />
      </View>
    );
  }

  const entering = reducedMotion ? undefined : FadeInDown.duration(400);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingBottom: insets.bottom + Spacing.xl,
      }}
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
        {macros.map((macro) => {
          const progress =
            macro.goal > 0
              ? Math.min(Math.max(macro.current / macro.goal, 0), 1)
              : 0;
          const accentColor = theme[macro.colorKey];

          return (
            <View
              key={macro.label}
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
                  {
                    backgroundColor: withOpacity(theme.border, 0.3),
                  },
                ]}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: accentColor,
                      width: `${progress * 100}%`,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </Animated.View>

      {/* Adaptive Goal Card (conditional on premium + recommendation) */}
      {adaptiveGoalData?.hasRecommendation &&
        adaptiveGoalData.recommendation && (
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInDown.duration(400).delay(200)
            }
          >
            <AdaptiveGoalCard
              recommendation={adaptiveGoalData.recommendation}
            />
          </Animated.View>
        )}
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
  ringSection: {
    paddingTop: Spacing.lg,
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
