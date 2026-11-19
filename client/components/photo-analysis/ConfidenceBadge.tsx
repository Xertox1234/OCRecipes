import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  getConfidenceTier,
  getConfidenceColor,
  getConfidenceLabel,
} from "@/lib/confidence";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const { theme } = useTheme();
  const tier = getConfidenceTier(confidence);
  const color = getConfidenceColor(theme, tier);
  const label = getConfidenceLabel(tier);

  return (
    <View
      style={[
        styles.confidenceBadge,
        { backgroundColor: withOpacity(color, 0.12) },
      ]}
      accessibilityLabel={`Confidence: ${Math.round(confidence * 100)}%`}
    >
      <ThemedText type="small" style={{ color }}>
        {label} Confidence ({Math.round(confidence * 100)}%)
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  confidenceBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
});
