import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { WeeklyRecipe } from "@shared/schemas/coach-weekly-report";
import { recipeCaption } from "./weekly-report-utils";

/** "New in your kitchen": the week's saved, favourited and imported recipes. */
export function KitchenRow({
  recipes,
  onOpen,
}: {
  recipes: WeeklyRecipe[];
  onOpen: (r: WeeklyRecipe) => void;
}) {
  const { theme } = useTheme();
  if (recipes.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {recipes.map((r) => (
        <PressableScale
          key={`${r.recipeType}:${r.recipeId}`}
          onPress={() => onOpen(r)}
          accessibilityRole="button"
          accessibilityLabel={`${r.title}. ${recipeCaption(r)}`}
          style={[
            styles.card,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <FallbackImage
            source={{ uri: r.imageUrl }}
            style={styles.image}
            fallbackIcon="book-open"
          />
          <View style={styles.body}>
            <ThemedText style={styles.title} numberOfLines={2}>
              {r.title}
            </ThemedText>
            <ThemedText
              style={[styles.caption, { color: theme.textSecondary }]}
            >
              {recipeCaption(r)}
            </ThemedText>
          </View>
        </PressableScale>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingRight: Spacing.lg },
  card: {
    width: 168,
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    overflow: "hidden",
  },
  image: { width: "100%", height: 96 },
  body: { padding: Spacing.md, gap: 4 },
  title: { fontFamily: FontFamily.semiBold, fontSize: 14, lineHeight: 19 },
  caption: { fontSize: 12 },
});
