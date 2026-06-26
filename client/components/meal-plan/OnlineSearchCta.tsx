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
import type { OnlineCtaState } from "@/screens/meal-plan/recipe-browser-utils";

interface OnlineSearchCtaProps {
  state: OnlineCtaState; // caller guarantees !== "hidden"
  onPress: () => void;
  onRetry: () => void;
}

export function OnlineSearchCta({
  state,
  onPress,
  onRetry,
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
          Searching online…
        </ThemedText>
      </View>
    );
  }

  if (state === "quota-exhausted") {
    return (
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry online search"
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
          Online search is temporarily unavailable. Tap to retry.
        </ThemedText>
      </Pressable>
    );
  }

  const locked = state === "premium-locked";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        locked
          ? "Search online for more recipes, Premium"
          : "Search online for more recipes"
      }
      style={({ pressed }) => [
        styles.card,
        { borderColor: withOpacity(accent, 0.4), opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Feather
        name={locked ? "lock" : "globe"}
        size={16}
        color={accent}
        accessible={false}
      />
      <ThemedText
        type="body"
        style={{ color: accent, fontFamily: FontFamily.semiBold }}
      >
        {locked ? "Search online · Premium" : "Search online for more"}
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
