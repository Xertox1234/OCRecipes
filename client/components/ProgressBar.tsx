import React from "react";
import { StyleSheet, View, ViewStyle, StyleProp } from "react-native";

import { useTheme } from "@/hooks/useTheme";

interface ProgressBarProps {
  /** Current value */
  value: number;
  /** Maximum value (defaults to 100). Guarded against zero. */
  max?: number;
  /** Fill color */
  color?: string;
  /** Track background color */
  trackColor?: string;
  /** Bar height in pixels (default: 8) */
  height?: number;
  /** Accessibility label describing what this progress bar represents */
  accessibilityLabel?: string;
  /** Container style overrides */
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({
  value,
  max = 100,
  color,
  trackColor,
  height = 8,
  accessibilityLabel,
  style,
}: ProgressBarProps) {
  const { theme } = useTheme();

  const safeMax = max || 1;
  const percentage = Math.min((value / safeMax) * 100, 100);
  const borderRadius = height / 2;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percentage) }}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.track,
        {
          height,
          borderRadius,
          backgroundColor: trackColor ?? theme.backgroundSecondary,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${percentage}%`,
            borderRadius,
            backgroundColor: color ?? theme.link,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: "hidden",
  },
  fill: {
    height: "100%",
  },
});
