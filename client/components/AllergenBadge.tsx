import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import {
  getAllergenBadgeVisuals,
  ALLERGEN_BADGE_FILL_OPACITY,
} from "./allergen-badge-utils";
import type { AllergySeverity } from "@shared/constants/allergens";

interface AllergenBadgeProps {
  /** The allergen label (e.g. "Peanuts", "Dairy/Milk"). */
  allergenLabel: string;
  severity: AllergySeverity;
}

/** Severity-coded inline badge for flagged ingredients. */
export const AllergenBadge = React.memo(function AllergenBadge({
  allergenLabel,
  severity,
}: AllergenBadgeProps) {
  const { theme } = useTheme();

  const { colorKey, icon } = getAllergenBadgeVisuals(severity);
  const color = theme[colorKey];

  const label =
    severity === "severe"
      ? `Severe allergen: ${allergenLabel}`
      : severity === "moderate"
        ? `Allergen: ${allergenLabel}`
        : `Contains: ${allergenLabel}`;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: withOpacity(color, ALLERGEN_BADGE_FILL_OPACITY) },
      ]}
      accessible={true}
      accessibilityLabel={label}
      accessibilityRole="text"
    >
      <Feather name={icon} size={12} color={color} accessible={false} />
      <ThemedText
        type="caption"
        maxScale={MAX_FONT_SCALE_CONSTRAINED}
        style={{ color, marginLeft: Spacing.xs, fontWeight: "600" }}
      >
        {allergenLabel}
      </ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
});
