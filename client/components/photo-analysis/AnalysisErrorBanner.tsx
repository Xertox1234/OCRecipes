import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";

/**
 * The photo-analysis failure banner. The live region is the message only: on
 * the container it re-read the Try again button with every change (TalkBack).
 * The iOS announce lives in usePhotoAnalysis.
 */
export function AnalysisErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.error, 0.12) },
      ]}
    >
      <Feather
        name="alert-circle"
        size={20}
        color={theme.error}
        accessible={false}
      />
      {/* badgeErrorText: plain `error` is 3.87:1 on its own tint. */}
      <ThemedText
        type="body"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={{ color: theme.badgeErrorText, flex: 1 }}
      >
        {message}
      </ThemedText>
      <Pressable
        onPress={onRetry}
        accessibilityLabel="Try again"
        accessibilityRole="button"
        style={styles.retry}
      >
        <ThemedText type="small" style={{ color: theme.link }}>
          Try Again
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  // A real 44pt box (no hitSlop — it cannot reach past the banner).
  retry: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
  },
});
