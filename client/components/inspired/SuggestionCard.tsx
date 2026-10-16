import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Button } from "@/components/Button";
import { ThemedText } from "@/components/ThemedText";
import { useHaptics } from "@/hooks/useHaptics";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import type { Suggestion } from "@shared/schemas/inspired-recipes";
import { formatMinutes } from "./suggestion-card-utils";

interface SuggestionCardProps {
  suggestion: Suggestion;
  making: boolean;
  onMake: () => void;
}

/**
 * A text-only idea card: title, pitch, time, and a "Make this mine" action that
 * generates the full recipe on demand (the recipe gets the photo).
 */
export function SuggestionCard({
  suggestion,
  making,
  onMake,
}: SuggestionCardProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handleMake = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    onMake();
  }, [haptics, onMake]);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={styles.body}>
        <ThemedText type="h4">{suggestion.title}</ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {suggestion.description}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {formatMinutes(suggestion.totalMinutes)}
        </ThemedText>
        <Button
          onPress={handleMake}
          disabled={making}
          loading={making}
          loadingText="Making…"
          accessibilityLabel={`Make ${suggestion.title} mine`}
          style={styles.button}
        >
          Make this mine
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  body: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  button: {
    marginTop: Spacing.sm,
  },
});
