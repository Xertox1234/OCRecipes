import React, { useEffect } from "react";
import { StyleSheet, View, AccessibilityInfo, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { getAllergenBannerMessage } from "./allergen-badge-utils";
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

  const message = getAllergenBannerMessage(matches);

  useEffect(() => {
    if (matches.length > 0 && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [matches.length, message]);

  if (matches.length === 0) return null;

  const highestSeverity = getHighestSeverity(matches);
  const color =
    highestSeverity === "severe"
      ? theme.error
      : highestSeverity === "moderate"
        ? theme.warning
        : theme.info;
  // `color` is the fill/icon tone; text needs the AA text token (light-mode
  // warning/info are 2.51:1 / 2.90:1 as text).
  const textColor =
    highestSeverity === "severe"
      ? theme.badgeErrorText
      : highestSeverity === "moderate"
        ? theme.badgeWarningText
        : theme.badgeInfoText;

  const icon: "alert-triangle" | "alert-circle" | "info" =
    highestSeverity === "severe"
      ? "alert-triangle"
      : highestSeverity === "moderate"
        ? "alert-circle"
        : "info";

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
        style={{
          color: textColor,
          marginLeft: Spacing.sm,
          flex: 1,
          fontWeight: "600",
        }}
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
