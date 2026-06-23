import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { RecipeCard as RecipeCardType } from "@shared/schemas/coach-blocks";

interface Props {
  block: RecipeCardType;
  onAction?: (action: Record<string, unknown>) => void;
}

const RecipeCard = React.memo(function RecipeCard({ block, onAction }: Props) {
  const { theme } = useTheme();
  const { recipe } = block;
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
    >
      <View
        style={styles.info}
        accessible={true}
        accessibilityLabel={`Recipe: ${recipe.title}. ${recipe.calories} calories, ${recipe.protein}g protein, ${recipe.prepTime}`}
      >
        <Text style={[styles.title, { color: theme.text }]}>
          {recipe.title}
        </Text>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>
          {recipe.calories} cal {"\u00B7"} {recipe.protein}g protein {"\u00B7"}{" "}
          {recipe.prepTime}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: theme.accentSolid }]}
          onPress={() =>
            onAction?.({
              type: "navigate",
              screen: "FeaturedRecipeDetail",
              params: { recipeId: recipe.recipeId, source: recipe.source },
            })
          }
          accessibilityRole="button"
          accessibilityLabel="View recipe"
          hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
        >
          <Text style={styles.primaryBtnText}>View</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryBtn}
          onPress={() =>
            onAction?.({
              type: "navigate",
              screen: "RecipeBrowserModal",
              params: { recipeId: recipe.recipeId },
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Add to meal plan"
          hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
        >
          <Text style={[styles.secondaryText, { color: theme.link }]}>
            Add to Plan
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

export default RecipeCard;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  info: { marginBottom: 8 },
  title: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  primaryBtn: {
    minHeight: 44,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" }, // hardcoded
  secondaryBtn: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 13 },
});
