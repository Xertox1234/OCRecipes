import React, { useCallback } from "react";
import { StyleSheet, View, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  useAcceptAdaptiveGoal,
  useDismissAdaptiveGoal,
  type AdaptiveGoalRecommendation,
} from "@/hooks/useAdaptiveGoals";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  calculateDiff,
  formatDiffLabel,
  formatWeightTrend,
} from "./adaptive-goal-card-utils";

interface AdaptiveGoalCardProps {
  recommendation: AdaptiveGoalRecommendation;
}

function MacroRow({
  label,
  previous,
  next,
  unit,
  color,
}: {
  label: string;
  previous: number;
  next: number;
  unit: string;
  color: string;
}) {
  const { theme } = useTheme();
  const { diff, isIncrease } = calculateDiff(previous, next);

  return (
    <View style={styles.macroRow}>
      <View style={[styles.macroDot, { backgroundColor: color }]} />
      <ThemedText type="small" style={styles.macroLabel}>
        {label}
      </ThemedText>
      <ThemedText
        type="small"
        style={[styles.macroPrevious, { color: theme.textSecondary }]}
      >
        {previous}
        {unit}
      </ThemedText>
      <Feather
        name={isIncrease ? "arrow-right" : "arrow-right"}
        size={12}
        color={theme.textSecondary}
      />
      <ThemedText type="small" style={styles.macroNext}>
        {next}
        {unit}
      </ThemedText>
      <ThemedText
        type="caption"
        style={{
          color: isIncrease ? theme.warning : theme.success,
          fontFamily: FontFamily.medium,
        }}
      >
        {formatDiffLabel(diff)}
      </ThemedText>
    </View>
  );
}

export const AdaptiveGoalCard = React.memo(function AdaptiveGoalCard({
  recommendation,
}: AdaptiveGoalCardProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const acceptMutation = useAcceptAdaptiveGoal();
  const dismissMutation = useDismissAdaptiveGoal();

  const handleAccept = useCallback(() => {
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    acceptMutation.mutate();
  }, [haptics, acceptMutation]);

  const handleDismiss = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    dismissMutation.mutate();
  }, [haptics, dismissMutation]);

  const isLoading = acceptMutation.isPending || dismissMutation.isPending;

  const { diff: calorieDiff, isIncrease: isCalorieIncrease } = calculateDiff(
    recommendation.previousCalories,
    recommendation.newCalories,
  );

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.delay(80).duration(400)}
      style={styles.wrapper}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: withOpacity(theme.info, 0.08) },
        ]}
        accessibilityRole="alert"
        accessibilityLabel={`Adaptive goal recommendation. ${recommendation.explanation}`}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: withOpacity(theme.info, 0.15) },
            ]}
          >
            <Feather name="trending-up" size={16} color={theme.info} />
          </View>
          <ThemedText type="body" style={styles.headerTitle}>
            Goal Adjustment Suggested
          </ThemedText>
        </View>

        {/* Explanation */}
        <ThemedText
          type="small"
          style={[styles.explanation, { color: theme.textSecondary }]}
        >
          {recommendation.explanation}
        </ThemedText>

        {/* Calorie summary */}
        <View
          style={[
            styles.calorieSummary,
            { backgroundColor: withOpacity(theme.text, 0.04) },
          ]}
        >
          <View style={styles.calorieBlock}>
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              Current
            </ThemedText>
            <ThemedText type="h4" style={styles.calorieValue}>
              {recommendation.previousCalories}
            </ThemedText>
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              kcal
            </ThemedText>
          </View>

          <Feather name="chevron-right" size={20} color={theme.textSecondary} />

          <View style={styles.calorieBlock}>
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, textAlign: "center" }}
            >
              Suggested
            </ThemedText>
            <ThemedText
              type="h4"
              style={[
                styles.calorieValue,
                {
                  color: isCalorieIncrease ? theme.warning : theme.success,
                },
              ]}
            >
              {recommendation.newCalories}
            </ThemedText>
            <ThemedText
              type="caption"
              style={{
                color: isCalorieIncrease ? theme.warning : theme.success,
                textAlign: "center",
              }}
            >
              {formatDiffLabel(calorieDiff)} kcal
            </ThemedText>
          </View>
        </View>

        {/* Macro changes */}
        <View style={styles.macroSection}>
          <MacroRow
            label="Protein"
            previous={recommendation.previousProtein}
            next={recommendation.newProtein}
            unit="g"
            color={theme.proteinAccent}
          />
          <MacroRow
            label="Carbs"
            previous={recommendation.previousCarbs}
            next={recommendation.newCarbs}
            unit="g"
            color={theme.carbsAccent}
          />
          <MacroRow
            label="Fat"
            previous={recommendation.previousFat}
            next={recommendation.newFat}
            unit="g"
            color={theme.fatAccent}
          />
        </View>

        {/* Weight trend rate */}
        {recommendation.weightTrendRate != null && (
          <ThemedText
            type="caption"
            style={[styles.trendInfo, { color: theme.textSecondary }]}
          >
            Weekly weight trend:{" "}
            {formatWeightTrend(recommendation.weightTrendRate!)}
          </ThemedText>
        )}

        {/* Action buttons */}
        <View style={styles.buttonRow}>
          <Pressable
            onPress={handleDismiss}
            disabled={isLoading}
            style={[
              styles.button,
              styles.dismissButton,
              { borderColor: theme.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss suggestion"
          >
            {dismissMutation.isPending ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <ThemedText
                type="small"
                style={[styles.buttonText, { color: theme.textSecondary }]}
              >
                Dismiss
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            onPress={handleAccept}
            disabled={isLoading}
            style={[
              styles.button,
              styles.acceptButton,
              { backgroundColor: theme.success },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Accept goal adjustment"
          >
            {acceptMutation.isPending ? (
              <ActivityIndicator size="small" color={theme.buttonText} />
            ) : (
              <ThemedText
                type="small"
                style={[styles.buttonText, { color: theme.buttonText }]}
              >
                Accept
              </ThemedText>
            )}
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  card: {
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
  },
  explanation: {
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  calorieSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xl,
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  calorieBlock: {
    alignItems: "center",
  },
  calorieValue: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
  },
  macroSection: {
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  macroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  macroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroLabel: {
    width: 56,
    fontFamily: FontFamily.medium,
  },
  macroPrevious: {
    width: 44,
    textAlign: "right",
  },
  macroNext: {
    width: 44,
    fontFamily: FontFamily.semiBold,
  },
  trendInfo: {
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.button,
    justifyContent: "center",
    alignItems: "center",
  },
  dismissButton: {
    borderWidth: 1,
  },
  acceptButton: {},
  buttonText: {
    fontFamily: FontFamily.semiBold,
  },
});
