import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Colors,
  Spacing,
  BorderRadius,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import {
  getScanFlagBadgeVisuals,
  SCAN_FLAG_BADGE_FILL_OPACITY,
} from "./scan-flag-badge-utils";
import type { ScanFlag } from "@shared/types/scan-flags";

/**
 * Severity-coded pill for a single ScanFlag. `scheme` pins the palette for a
 * surface that ignores the app theme — the scan camera's cards are always
 * dark, so a light-mode phone would otherwise draw light badge text on them.
 */
export const ScanFlagBadge = React.memo(function ScanFlagBadge({
  flag,
  scheme,
}: {
  flag: ScanFlag;
  scheme?: "light" | "dark";
}) {
  const { theme: appTheme } = useTheme();
  const theme = scheme ? Colors[scheme] : appTheme;
  const { colorKey, icon } = getScanFlagBadgeVisuals(flag.severity);
  const color = theme[colorKey];
  const a11y = flag.detail ? `${flag.title}. ${flag.detail}` : flag.title;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: withOpacity(color, SCAN_FLAG_BADGE_FILL_OPACITY),
        },
      ]}
      accessible={true}
      accessibilityLabel={a11y}
      accessibilityRole="text"
    >
      <Feather name={icon} size={14} color={color} accessible={false} />
      <ThemedText
        type="caption"
        maxScale={MAX_FONT_SCALE_CONSTRAINED}
        style={{ color, marginLeft: Spacing.xs, fontWeight: "600" }}
      >
        {flag.title}
      </ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
});
