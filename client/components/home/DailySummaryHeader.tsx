import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { CarouselError } from "@/components/home/CarouselError";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { resolveImageUrl } from "@/lib/query-client";
import { Spacing, FontFamily } from "@/constants/theme";
import type { DailyBudget } from "@/hooks/useDailyBudget";

function formatCalorieSummary(consumed: number, goal: number): string {
  return `${Math.round(consumed).toLocaleString()} / ${Math.round(goal).toLocaleString()} cal today`;
}

const AVATAR_SIZE = 28;

interface DailySummaryHeaderProps {
  onCalorieTap: () => void;
  budget: DailyBudget | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export const DailySummaryHeader = React.memo(function DailySummaryHeader({
  onCalorieTap,
  budget,
  isLoading,
  isError,
  refetch,
}: DailySummaryHeaderProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { user } = useAuthContext();

  const displayName = user?.displayName || user?.username || "there";

  return (
    <View style={styles.container}>
      {/* Greeting row */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(50).duration(400)
        }
        style={styles.greetingRow}
      >
        <View style={styles.greetingLeft}>
          <FallbackImage
            source={{ uri: resolveImageUrl(user?.avatarUrl) ?? undefined }}
            style={styles.avatar}
            fallbackStyle={styles.avatarPlaceholder}
            fallbackIcon="user"
            fallbackIconSize={14}
            accessibilityLabel={`${displayName}'s profile photo`}
          />
          <ThemedText type="body" style={styles.greeting}>
            Hello {displayName}
          </ThemedText>
        </View>
      </Animated.View>

      {/* Tappable calorie summary */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(100).duration(400)
        }
      >
        {isLoading ? (
          <SkeletonBox
            width={180}
            height={20}
            style={{ marginTop: Spacing.xs }}
          />
        ) : budget ? (
          <Pressable
            onPress={onCalorieTap}
            accessibilityRole="button"
            accessibilityLabel={`${formatCalorieSummary(budget.foodCalories, budget.calorieGoal)}. Tap for details.`}
            style={styles.calorieTap}
          >
            <ThemedText
              type="body"
              style={[styles.calorieText, { color: theme.textSecondary }]}
            >
              {formatCalorieSummary(budget.foodCalories, budget.calorieGoal)}
            </ThemedText>
            <Feather
              name="chevron-right"
              size={14}
              color={theme.textSecondary}
              accessible={false}
            />
          </Pressable>
        ) : isError ? (
          <CarouselError
            label="your calorie summary"
            onRetry={() => void refetch()}
          />
        ) : null}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greetingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  greeting: {
    fontFamily: FontFamily.medium,
  },
  calorieTap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  calorieText: {
    fontSize: 14,
  },
});
