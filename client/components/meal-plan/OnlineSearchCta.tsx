// client/components/meal-plan/OnlineSearchCta.tsx
import React from "react";
import { Pressable, StyleSheet, View, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { IdeasCtaState } from "@/screens/meal-plan/recipe-browser-utils";

interface OnlineSearchCtaProps {
  state: IdeasCtaState;
  /** Requests ideas (idle/error) or opens the upgrade prompt (locked). */
  onPress: () => void;
  /** Overrides the error copy, e.g. when the daily idea cap is reached. */
  errorText?: string;
  /** False when retrying can't help (daily cap) — the error is shown, not tappable. */
  retryable?: boolean;
}

/** The "Ideas for you" call to action under the Recipe Browser's results. */
export function OnlineSearchCta({
  state,
  onPress,
  errorText,
  retryable = true,
}: OnlineSearchCtaProps) {
  const { theme } = useTheme();
  // Brand accent for text/icons/tints is `theme.link` (terracotta; see
  // client/constants/theme.ts:19 — "Use `link` for text/icons/tints,
  // accentSolid for fills"). There is NO `theme.primary` key — do not use one.
  const accent = theme.link;

  if (state === "hidden") return null;

  if (state === "loading") {
    return (
      <View
        style={[styles.card, { borderColor: withOpacity(accent, 0.4) }]}
        accessibilityRole="text"
      >
        <ActivityIndicator color={accent} />
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Finding ideas for you…
        </ThemedText>
      </View>
    );
  }

  if (state === "error") {
    const message = errorText ?? "Couldn't come up with ideas. Tap to retry.";
    return (
      <Pressable
        onPress={onPress}
        disabled={!retryable}
        accessibilityRole="button"
        accessibilityState={{ disabled: !retryable }}
        accessibilityLabel={message}
        style={({ pressed }) => [
          styles.card,
          {
            borderColor: withOpacity(accent, 0.4),
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather
          name="alert-circle"
          size={16}
          color={theme.textSecondary}
          accessible={false}
        />
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {message}
        </ThemedText>
      </Pressable>
    );
  }

  const locked = state === "locked";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        locked ? "Get ideas made for you, Premium" : "Get ideas made for you"
      }
      style={({ pressed }) => [
        styles.card,
        { borderColor: withOpacity(accent, 0.4), opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Feather
        name={locked ? "lock" : "zap"}
        size={16}
        color={accent}
        accessible={false}
      />
      <ThemedText
        type="body"
        style={{ color: accent, fontFamily: FontFamily.semiBold }}
      >
        {locked ? "Ideas for you · Premium" : "Get ideas made for you"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginVertical: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: BorderRadius.card,
  },
});
