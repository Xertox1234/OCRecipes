import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, MAX_FONT_SCALE_CONSTRAINED } from "@/constants/theme";
import { getNutriScoreVisuals } from "./nutri-score-chip-utils";
import type { NutriScoreGrade } from "./nutri-score-chip-utils";

interface NutriScoreChipProps {
  grade: NutriScoreGrade;
}

/** Solid WCAG-AA pill rendering a Nutri-Score A–E grade letter. */
export const NutriScoreChip = React.memo(function NutriScoreChip({
  grade,
}: NutriScoreChipProps) {
  const { theme } = useTheme();
  const { bg, fg, label } = getNutriScoreVisuals(grade, theme);

  return (
    <View
      style={[styles.chip, { backgroundColor: bg }]}
      accessible={true}
      accessibilityLabel={`Nutri-Score ${grade.toUpperCase()}`}
      accessibilityRole="text"
    >
      <ThemedText
        type="caption"
        maxScale={MAX_FONT_SCALE_CONSTRAINED}
        style={[styles.label, { color: fg }]}
        accessible={false}
      >
        {label}
      </ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontWeight: "700",
  },
});
