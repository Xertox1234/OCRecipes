import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { AbsoluteFill, Spacing } from "@/constants/theme";

/** Shown by both platform CameraViews when no camera device is available. */
export function CameraUnavailable() {
  const { theme } = useTheme();
  return (
    <View
      style={[styles.unavailable, { backgroundColor: theme.backgroundDefault }]}
    >
      <Feather
        name="camera-off"
        size={48}
        color={theme.textSecondary}
        accessible={false}
      />
      <ThemedText type="h4" style={styles.unavailableTitle}>
        Camera unavailable
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.unavailableSubtitle, { color: theme.textSecondary }]}
      >
        Camera is not available on this device
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  unavailable: {
    ...AbsoluteFill,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing["3xl"],
  },
  unavailableTitle: {
    marginTop: Spacing.sm,
  },
  unavailableSubtitle: {
    textAlign: "center",
  },
});
