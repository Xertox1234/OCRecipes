import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { getBadgeConfig } from "./verification-badge-utils";
import type { VerificationLevel } from "@shared/types/verification";

interface VerificationBadgeProps {
  level: VerificationLevel;
}

export const VerificationBadge = React.memo(function VerificationBadge({
  level,
}: VerificationBadgeProps) {
  const { theme } = useTheme();
  const config = getBadgeConfig(level);
  const color = theme[config.colorKey];

  return (
    <View
      style={[styles.badge, { backgroundColor: withOpacity(color, 0.12) }]}
      accessibilityLabel={config.a11yLabel}
      accessibilityRole="text"
    >
      <Feather name={config.icon} size={14} color={color} accessible={false} />
      <ThemedText style={[styles.label, { color }]}>{config.label}</ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});
