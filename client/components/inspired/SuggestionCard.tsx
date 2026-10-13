import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Button } from "@/components/Button";
import { FallbackImage } from "@/components/FallbackImage";
import { ThemedText } from "@/components/ThemedText";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { resolveImageUrl } from "@/lib/query-client";
import type { Suggestion } from "@shared/schemas/inspired-recipes";
import { formatMinutes } from "./suggestion-card-utils";

interface SuggestionCardProps {
  suggestion: Suggestion;
  imageUrl: string | null;
  making: boolean;
  onMake: () => void;
}

/**
 * An idea card: photo (filled in asynchronously), title, one-line pitch, time,
 * and a "Make this mine" action that generates the full recipe on demand.
 */
export function SuggestionCard({
  suggestion,
  imageUrl,
  making,
  onMake,
}: SuggestionCardProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const haptics = useHaptics();

  const handleMake = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    onMake();
  }, [haptics, onMake]);

  const resolvedUri = resolveImageUrl(imageUrl);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundSecondary }]}>
      <FallbackImage
        source={resolvedUri ? { uri: resolvedUri } : undefined}
        style={styles.photo}
        contentFit="cover"
        transition={reducedMotion ? 0 : 220}
        accessibilityIgnoresInvertColors
      />
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
  photo: {
    width: "100%",
    aspectRatio: 16 / 10,
  },
  body: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  button: {
    marginTop: Spacing.sm,
  },
});
