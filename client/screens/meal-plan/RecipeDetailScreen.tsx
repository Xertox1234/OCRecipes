import React, { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { RecipeDetailContent } from "@/components/RecipeDetailContent";
import { RecipeDetailSkeleton } from "@/components/recipe-detail";
import {
  formatTimeDisplay,
  parseNutritionData,
} from "@/components/recipe-detail/recipe-detail-utils";
import { resolveImageUrl } from "@/lib/query-client";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { useMealPlanRecipeDetail } from "@/hooks/useMealPlanRecipes";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type RecipeDetailRouteProp = RouteProp<MealPlanStackParamList, "RecipeDetail">;

export default function RecipeDetailScreen() {
  const route = useRoute<RecipeDetailRouteProp>();
  const { recipeId } = route.params;
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();

  const { data: recipe, isLoading, error } = useMealPlanRecipeDetail(recipeId);

  const imageUri = useMemo(
    () => resolveImageUrl(recipe?.imageUrl),
    [recipe?.imageUrl],
  );

  const timeDisplay = useMemo(
    () =>
      recipe
        ? formatTimeDisplay(recipe.prepTimeMinutes, recipe.cookTimeMinutes)
        : null,
    [recipe],
  );

  const nutrition = useMemo(
    () => (recipe ? parseNutritionData(recipe) : null),
    [recipe],
  );

  if (isLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <ScrollView
          contentContainerStyle={{ paddingTop: headerHeight + Spacing.sm }}
          contentInsetAdjustmentBehavior="never"
        >
          <RecipeDetailSkeleton />
        </ScrollView>
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View
        style={[
          styles.centered,
          { paddingTop: headerHeight, backgroundColor: theme.backgroundRoot },
        ]}
      >
        <Feather name="alert-circle" size={32} color={theme.error} />
        <ThemedText
          style={{ marginTop: Spacing.md, color: theme.textSecondary }}
        >
          Recipe not found
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <RecipeDetailContent
        recipeId={recipeId}
        recipeType="mealPlan"
        title={recipe.title}
        description={recipe.description}
        imageUrl={imageUri}
        timeDisplay={timeDisplay}
        difficulty={recipe.difficulty}
        servings={recipe.servings}
        dietTags={recipe.dietTags ?? []}
        nutrition={nutrition}
        ingredients={recipe.ingredients}
        instructions={recipe.instructions}
        contentPaddingTop={headerHeight + Spacing.sm}
        contentPaddingBottom={tabBarHeight + Spacing.xl}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
