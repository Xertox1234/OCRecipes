import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { isHighStreak, formatStreakLabel } from "./fasting-display-utils";

interface FastingStreakBadgeProps {
  streak: number;
  /** Compact mode for use in headers or small spaces */
  compact?: boolean;
}

export const FastingStreakBadge = React.memo(function FastingStreakBadge({
  streak,
  compact = false,
}: FastingStreakBadgeProps) {
  const { theme } = useTheme();

  if (streak <= 0) return null;

  const badgeColor = isHighStreak(streak) ? theme.warning : theme.calorieAccent;

  if (compact) {
    return (
      <View
        style={[
          styles.compactBadge,
          { backgroundColor: withOpacity(badgeColor, 0.15) },
        ]}
        accessibilityLabel={`${streak} day fasting streak`}
        accessibilityRole="text"
      >
        <Feather name="zap" size={12} color={badgeColor} />
        <ThemedText style={[styles.compactText, { color: badgeColor }]}>
          {streak}
        </ThemedText>
      </View>
    );
  }

  return (
    <View
      style={[styles.badge, { backgroundColor: withOpacity(badgeColor, 0.12) }]}
      accessibilityLabel={`${streak} day fasting streak`}
      accessibilityRole="text"
    >
      <Feather name="zap" size={18} color={badgeColor} />
      <View>
        <ThemedText style={[styles.streakCount, { color: badgeColor }]}>
          {formatStreakLabel(streak)}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Current streak
        </ThemedText>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.sm,
  },
  streakCount: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
  compactBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.chip,
    gap: 4,
  },
  compactText: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
});
