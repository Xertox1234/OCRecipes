import React, { useMemo } from "react";
import { StyleSheet, View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { RecipeDetailContent } from "@/components/RecipeDetailContent";
import { RecipeDetailSkeleton } from "@/components/recipe-detail";
import type { IngredientItem } from "@/components/recipe-detail";
import {
  formatTimeDisplay,
  parseNutritionData,
} from "@/components/recipe-detail/recipe-detail-utils";
import { apiRequest, resolveImageUrl } from "@/lib/query-client";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, withOpacity } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type {
  CommunityRecipe,
  MealPlanRecipe,
  RecipeIngredient,
} from "@shared/schema";
import type { CarouselRecipeCard } from "@shared/types/carousel";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

const HANDLE_WIDTH = 36;
const HANDLE_HEIGHT = 5;

type FeaturedRecipeDetailRouteProp = RouteProp<
  RootStackParamList,
  "FeaturedRecipeDetail"
>;

type MealPlanRecipeWithIngredients = MealPlanRecipe & {
  ingredients: RecipeIngredient[];
};

interface NormalizedRecipe {
  title: string;
  description?: string | null;
  difficulty?: string | null;
  timeDisplay?: string | null;
  servings?: number | null;
  dietTags: string[];
  instructions: string[];
  ingredients: IngredientItem[];
  imageUrl?: string | null;
  nutrition?: ReturnType<typeof parseNutritionData>;
}

/** Normalize a carousel card into the props RecipeDetailContent needs. */
function normalizeCarouselCard(card: CarouselRecipeCard): NormalizedRecipe {
  const data = card.recipeData;

  if (card.source === "ai") {
    const ai = data as MealSuggestion;
    return {
      title: card.title,
      description: ai.description,
      difficulty: ai.difficulty,
      timeDisplay: ai.prepTimeMinutes ? `${ai.prepTimeMinutes} minutes` : null,
      servings: 2,
      dietTags: ai.dietTags ?? [],
      instructions: ai.instructions ?? [],
      ingredients: [] as IngredientItem[],
      imageUrl: card.imageUrl,
    };
  }

  if (card.source === "community" && "instructions" in data) {
    const community = data as unknown as CommunityRecipe;
    return {
      title: community.title,
      description: community.description,
      difficulty: community.difficulty,
      timeDisplay: community.timeEstimate,
      servings: community.servings,
      dietTags: community.dietTags ?? [],
      instructions: community.instructions ?? [],
      ingredients: (community.ingredients ?? []) as IngredientItem[],
      imageUrl: community.imageUrl,
    };
  }

  // Catalog recipes (minimal data)
  return {
    title: card.title,
    description: card.recommendationReason,
    difficulty: null,
    timeDisplay: card.prepTimeMinutes
      ? `${card.prepTimeMinutes} minutes`
      : null,
    servings: null,
    dietTags: [] as string[],
    instructions: [] as string[],
    ingredients: [] as IngredientItem[],
    imageUrl: card.imageUrl,
  };
}

export default function FeaturedRecipeDetailScreen() {
  const route = useRoute<FeaturedRecipeDetailRouteProp>();
  const { recipeId, recipeType = "community", carouselCard } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  // --- Community recipe fetch ---
  const {
    data: communityRecipe,
    isLoading: communityLoading,
    error: communityError,
  } = useQuery<CommunityRecipe>({
    queryKey: [`/api/recipes/${recipeId}`],
    enabled: !carouselCard && recipeType === "community" && recipeId > 0,
  });

  // --- Meal plan recipe fetch ---
  const {
    data: mealPlanRecipe,
    isLoading: mealPlanLoading,
    error: mealPlanError,
  } = useQuery<MealPlanRecipeWithIngredients>({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meal-plan/recipes/${recipeId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !carouselCard && recipeType === "mealPlan" && recipeId > 0,
  });

  // --- Normalize all sources into RecipeDetailContent props ---
  const normalized = useMemo((): NormalizedRecipe | null => {
    if (carouselCard) return normalizeCarouselCard(carouselCard);

    if (recipeType === "mealPlan" && mealPlanRecipe) {
      return {
        title: mealPlanRecipe.title,
        description: mealPlanRecipe.description,
        difficulty: mealPlanRecipe.difficulty,
        timeDisplay: formatTimeDisplay(
          mealPlanRecipe.prepTimeMinutes,
          mealPlanRecipe.cookTimeMinutes,
        ),
        servings: mealPlanRecipe.servings,
        dietTags: mealPlanRecipe.dietTags ?? [],
        instructions: mealPlanRecipe.instructions ?? [],
        ingredients: mealPlanRecipe.ingredients as IngredientItem[],
        imageUrl: mealPlanRecipe.imageUrl,
        nutrition: parseNutritionData(mealPlanRecipe),
      };
    }

    if (communityRecipe) {
      return {
        title: communityRecipe.title,
        description: communityRecipe.description,
        difficulty: communityRecipe.difficulty,
        timeDisplay: communityRecipe.timeEstimate,
        servings: communityRecipe.servings,
        dietTags: communityRecipe.dietTags ?? [],
        instructions: communityRecipe.instructions ?? [],
        ingredients: (communityRecipe.ingredients ?? []) as IngredientItem[],
        imageUrl: communityRecipe.imageUrl,
      };
    }

    return null;
  }, [carouselCard, recipeType, mealPlanRecipe, communityRecipe]);

  const isLoading =
    !carouselCard &&
    (recipeType === "community" ? communityLoading : mealPlanLoading);
  const error = recipeType === "community" ? communityError : mealPlanError;

  const imageUri = useMemo(
    () => resolveImageUrl(normalized?.imageUrl),
    [normalized?.imageUrl],
  );

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      accessibilityViewIsModal
    >
      {/* Drag handle */}
      <View
        style={[styles.handleContainer, { top: insets.top + Spacing.xs }]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.handle,
            { backgroundColor: withOpacity(theme.text, 0.3) },
          ]}
        />
      </View>

      {isLoading ? (
        <ScrollView contentInsetAdjustmentBehavior="never">
          <RecipeDetailSkeleton />
        </ScrollView>
      ) : error || !normalized ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={theme.textSecondary} />
          <ThemedText
            style={{ marginTop: Spacing.sm, color: theme.textSecondary }}
          >
            Recipe not found
          </ThemedText>
        </View>
      ) : (
        <RecipeDetailContent
          recipeId={recipeId}
          recipeType={recipeType}
          title={normalized.title}
          description={normalized.description}
          imageUrl={imageUri}
          timeDisplay={normalized.timeDisplay}
          difficulty={normalized.difficulty}
          servings={normalized.servings}
          dietTags={normalized.dietTags}
          nutrition={normalized.nutrition ?? null}
          ingredients={normalized.ingredients}
          instructions={normalized.instructions}
          contentPaddingBottom={insets.bottom + Spacing.xl}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  handleContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
  },
  handle: {
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderRadius: HANDLE_HEIGHT / 2,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
