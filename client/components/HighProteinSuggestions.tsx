import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useHighProteinSuggestions } from "@/hooks/useMedication";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

export const HighProteinSuggestions = React.memo(
  function HighProteinSuggestions({ enabled = true }: { enabled?: boolean }) {
    const { theme } = useTheme();
    const { data, isLoading } = useHighProteinSuggestions(enabled);

    if (isLoading || !data?.suggestions?.length) return null;

    return (
      <View
        style={styles.container}
        accessibilityRole="none"
        accessibilityLabel={`High protein suggestions. ${data.remainingProtein}g protein remaining today.`}
      >
        <View style={styles.header}>
          <Feather name="target" size={16} color={theme.success} />
          <ThemedText type="h4" style={styles.title}>
            High-Protein Ideas
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {data.remainingProtein}g remaining
          </ThemedText>
        </View>

        <View style={styles.cardsRow}>
          {data.suggestions.map((suggestion) => (
            <Card
              key={suggestion.title}
              elevation={1}
              style={styles.suggestionCard}
              accessibilityLabel={`${suggestion.title}: ${suggestion.proteinGrams}g protein, ${suggestion.calories} calories`}
            >
              <View style={styles.cardContent}>
                <View
                  style={[
                    styles.proteinBadge,
                    { backgroundColor: withOpacity(theme.success, 0.12) },
                  ]}
                >
                  <ThemedText
                    style={[styles.proteinText, { color: theme.success }]}
                  >
                    {suggestion.proteinGrams}g
                  </ThemedText>
                </View>
                <ThemedText
                  type="body"
                  style={styles.suggestionTitle}
                  numberOfLines={2}
                >
                  {suggestion.title}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                  numberOfLines={2}
                >
                  {suggestion.description}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary, marginTop: 2 }}
                >
                  {suggestion.portionSize} · {suggestion.calories} cal
                </ThemedText>
              </View>
            </Card>
          ))}
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  title: {
    flex: 1,
  },
  cardsRow: {
    gap: Spacing.sm,
  },
  suggestionCard: {
    padding: 0,
  },
  cardContent: {
    padding: Spacing.md,
    gap: 4,
  },
  proteinBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
    marginBottom: 2,
  },
  proteinText: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
  suggestionTitle: {
    fontWeight: "600",
  },
});
