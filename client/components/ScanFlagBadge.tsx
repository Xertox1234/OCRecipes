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
import type { ScanFlag, ScanFlagSeverity } from "@shared/types/scan-flags";

const ICON: Record<
  ScanFlagSeverity,
  "alert-triangle" | "alert-circle" | "info"
> = {
  danger: "alert-triangle",
  warn: "alert-circle",
  info: "info",
};

/** Severity-coded pill for a single ScanFlag. */
export const ScanFlagBadge = React.memo(function ScanFlagBadge({
  flag,
}: {
  flag: ScanFlag;
}) {
  const { theme } = useTheme();
  const color =
    flag.severity === "danger"
      ? theme.error
      : flag.severity === "warn"
        ? theme.warning
        : theme.info;
  const a11y = flag.detail ? `${flag.title}. ${flag.detail}` : flag.title;

  return (
    <View
      style={[styles.badge, { backgroundColor: withOpacity(color, 0.1) }]}
      accessible={true}
      accessibilityLabel={a11y}
      accessibilityRole="text"
    >
      <Feather
        name={ICON[flag.severity]}
        size={14}
        color={color}
        accessible={false}
      />
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
