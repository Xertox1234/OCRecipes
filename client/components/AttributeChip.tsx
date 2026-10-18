import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import type { BadgeSeverityColorKey } from "./badge-severity-visuals";
import {
  ATTRIBUTE_CHIP_FILL_OPACITY,
  type AttributeIconName,
} from "./recipe-attribute-visuals";

interface AttributeChipProps {
  icon: AttributeIconName;
  colorKey: BadgeSeverityColorKey;
  word: string;
}

/**
 * Icon + word pill (the `AllergenBadge` look). Decorative: the parent row or
 * card carries the spoken label and hides this chip from the a11y tree.
 */
export const AttributeChip = React.memo(function AttributeChip({
  icon,
  colorKey,
  word,
}: AttributeChipProps) {
  const { theme } = useTheme();
  const color = theme[colorKey];
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: withOpacity(color, ATTRIBUTE_CHIP_FILL_OPACITY) },
      ]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={13}
        color={color}
        accessible={false}
      />
      <ThemedText
        type="caption"
        maxScale={MAX_FONT_SCALE_CONSTRAINED}
        style={{ color, marginLeft: Spacing.xs, fontWeight: "600" }}
      >
        {word}
      </ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
});
