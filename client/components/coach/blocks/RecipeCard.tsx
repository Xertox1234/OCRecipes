import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { RecipeCard as RecipeCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: RecipeCardType;
  onAction?: (action: Record<string, unknown>) => void;
}

export default function RecipeCard({ block, onAction }: Props) {
  const { theme } = useTheme();
  const { recipe } = block;
  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]} accessibilityLabel={`Recipe: ${recipe.title}. ${recipe.calories} calories, ${recipe.protein}g protein, ${recipe.prepTime}`}>
      <View style={styles.info}>
        <Text style={[styles.title, { color: theme.text }]}>{recipe.title}</Text>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>
          {recipe.calories} cal {"\u00B7"} {recipe.protein}g protein {"\u00B7"} {recipe.prepTime}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.link }]}
          onPress={() => onAction?.({ type: "navigate", screen: "RecipeDetail", params: { recipeId: recipe.recipeId, source: recipe.source } })}
          accessibilityRole="button"
          accessibilityLabel="View recipe"
        >
          <Text style={styles.primaryBtnText}>View</Text>
        </Pressable>
        <Pressable
          onPress={() => onAction?.({ type: "navigate", screen: "MealPlanPicker", params: { recipeId: recipe.recipeId } })}
          accessibilityRole="button"
          accessibilityLabel="Add to meal plan"
        >
          <Text style={[styles.secondaryText, { color: theme.link }]}>Add to Plan</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  info: { marginBottom: 8 },
  title: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  primaryBtn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  primaryBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  secondaryText: { fontSize: 13 },
});
