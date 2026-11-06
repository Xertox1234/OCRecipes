import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import {
  BADGE_SEVERITY_FILL_OPACITY,
  type BadgeSeverityVisuals,
} from "@/components/badge-severity-visuals";

/**
 * The band's coloured dot. Decorative: the row's own label already speaks
 * the band, so the dot is kept out of the accessibility tree.
 */
export function BandDot({
  visuals,
  testID,
}: {
  visuals: BadgeSeverityVisuals;
  testID?: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      accessibilityElementsHidden
      aria-hidden
      style={[styles.dot, { backgroundColor: theme[visuals.colorKey] }]}
    />
  );
}

/**
 * The band's tinted pill: icon + tag word. Hidden from the accessibility tree
 * with its children — the tag word is redundant with the row's spoken label.
 */
export function BandPill({
  visuals,
  tag,
}: {
  visuals: BadgeSeverityVisuals;
  tag: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: withOpacity(
            theme[visuals.colorKey],
            BADGE_SEVERITY_FILL_OPACITY,
          ),
        },
      ]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      aria-hidden
    >
      <Feather
        name={visuals.icon}
        size={12}
        color={theme[visuals.colorKey]}
        accessible={false}
      />
      <ThemedText
        type="caption"
        style={[styles.tagText, { color: theme[visuals.colorKey] }]}
      >
        {tag}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  tagText: {
    fontWeight: "600",
  },
});
