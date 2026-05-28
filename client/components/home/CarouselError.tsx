import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface CarouselErrorProps {
  /** Human-readable name of the failed section, used in the retry label. */
  label: string;
  /** Re-runs the failed query. */
  onRetry: () => void;
}

/**
 * Inline "fetch failed" state for the Home carousels — distinguishes a genuine
 * empty list (render nothing) from a failed fetch (show a recoverable error).
 * Follows the query-error-retry pattern: a message plus an accessible Retry
 * button. The container is an `alert` so screen readers announce the failure.
 */
export const CarouselError = React.memo(function CarouselError({
  label,
  onRetry,
}: CarouselErrorProps) {
  const { theme } = useTheme();

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.error, 0.06) },
      ]}
    >
      <Feather
        name="alert-circle"
        size={16}
        color={theme.error}
        accessible={false}
      />
      <ThemedText type="small" style={[styles.message, { color: theme.error }]}>
        Couldn&apos;t load {label}.
      </ThemedText>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={`Retry loading ${label}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={({ pressed }) => [
          styles.retryButton,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather
          name="refresh-cw"
          size={14}
          color={theme.link}
          accessible={false}
        />
        <ThemedText
          type="small"
          style={[styles.retryText, { color: theme.link }]}
        >
          Retry
        </ThemedText>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  message: {
    flex: 1,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  retryText: {
    fontFamily: FontFamily.semiBold,
  },
});
