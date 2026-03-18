import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type {
  AllergenMatch,
  AllergySeverity,
} from "@shared/constants/allergens";

interface AllergenWarningBannerProps {
  matches: AllergenMatch[];
}

/**
 * Summary banner shown above an ingredients section when allergens are detected.
 * Color is determined by the highest severity among all matches.
 */
export const AllergenWarningBanner = React.memo(function AllergenWarningBanner({
  matches,
}: AllergenWarningBannerProps) {
  const { theme } = useTheme();

  if (matches.length === 0) return null;

  const highestSeverity = getHighestSeverity(matches);
  const color =
    highestSeverity === "severe"
      ? theme.error
      : highestSeverity === "moderate"
        ? theme.warning
        : theme.info;

  const icon: "alert-triangle" | "alert-circle" | "info" =
    highestSeverity === "severe"
      ? "alert-triangle"
      : highestSeverity === "moderate"
        ? "alert-circle"
        : "info";

  const count = new Set(matches.map((m) => m.ingredientName)).size;
  const message =
    count === 1
      ? "1 ingredient contains your allergens"
      : `${count} ingredients contain your allergens`;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: withOpacity(color, 0.08),
          borderLeftColor: color,
        },
      ]}
    >
      <Feather name={icon} size={18} color={color} accessible={false} />
      <ThemedText
        type="small"
        style={{ color, marginLeft: Spacing.sm, flex: 1, fontWeight: "600" }}
      >
        {message}
      </ThemedText>
    </View>
  );
});

const SEVERITY_ORDER: Record<AllergySeverity, number> = {
  mild: 0,
  moderate: 1,
  severe: 2,
};

function getHighestSeverity(matches: AllergenMatch[]): AllergySeverity {
  let highest: AllergySeverity = "mild";
  for (const m of matches) {
    if (SEVERITY_ORDER[m.severity] > SEVERITY_ORDER[highest]) {
      highest = m.severity;
    }
  }
  return highest;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderLeftWidth: 3,
  },
});
