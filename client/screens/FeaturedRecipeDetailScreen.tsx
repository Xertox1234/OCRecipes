import React, { useMemo } from "react";
import { Pressable, StyleSheet, View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
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
  remixedFromId?: number | null;
  remixedFromTitle?: string | null;
  // Curated recipe fields
  isCanonical?: boolean;
  canonicalImages?: string[] | null;
  instructionDetails?: (string | null)[] | null;
  toolsRequired?: { name: string; affiliateUrl?: string }[] | null;
  chefTips?: string[] | null;
  cuisineOrigin?: string | null;
}

export default function FeaturedRecipeDetailScreen() {
  const route = useRoute<FeaturedRecipeDetailRouteProp>();
  const { recipeId, recipeType, type } = route.params;
  const resolvedRecipeType = recipeType ?? type ?? "community";
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  // --- Community recipe fetch ---
  const {
    data: communityRecipe,
    isLoading: communityLoading,
    error: communityError,
  } = useQuery<CommunityRecipe>({
    queryKey: [`/api/recipes/${recipeId}`],
    enabled: resolvedRecipeType === "community" && recipeId > 0,
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
    enabled: resolvedRecipeType === "mealPlan" && recipeId > 0,
  });

  // --- Normalize into RecipeDetailContent props ---
  const normalized = useMemo((): NormalizedRecipe | null => {
    if (resolvedRecipeType === "mealPlan" && mealPlanRecipe) {
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
        isCanonical: false,
        canonicalImages: [],
        instructionDetails: [],
        toolsRequired: [],
        chefTips: [],
        cuisineOrigin: null,
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
        remixedFromId: communityRecipe.remixedFromId,
        remixedFromTitle: communityRecipe.remixedFromTitle,
        isCanonical: communityRecipe.isCanonical,
        canonicalImages: (communityRecipe.canonicalImages as string[]) ?? [],
        instructionDetails:
          (communityRecipe.instructionDetails as (string | null)[]) ?? [],
        toolsRequired:
          (communityRecipe.toolsRequired as {
            name: string;
            affiliateUrl?: string;
          }[]) ?? [],
        chefTips: (communityRecipe.chefTips as string[]) ?? [],
        cuisineOrigin: communityRecipe.cuisineOrigin ?? null,
      };
    }

    return null;
  }, [resolvedRecipeType, mealPlanRecipe, communityRecipe]);

  const isLoading =
    resolvedRecipeType === "community" ? communityLoading : mealPlanLoading;
  const error =
    resolvedRecipeType === "community" ? communityError : mealPlanError;

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

      {/* Close button */}
      <Pressable
        onPress={() => navigation.goBack()}
        style={[
          styles.closeButton,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: withOpacity(theme.backgroundRoot, 0.7),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Close recipe"
        hitSlop={12}
      >
        <Feather name="x" size={22} color={theme.text} />
      </Pressable>

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
          recipeType={resolvedRecipeType}
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
          remixedFromId={normalized.remixedFromId}
          remixedFromTitle={normalized.remixedFromTitle}
          isCanonical={normalized.isCanonical}
          canonicalImages={normalized.canonicalImages}
          instructionDetails={normalized.instructionDetails}
          toolsRequired={normalized.toolsRequired}
          chefTips={normalized.chefTips}
          cuisineOrigin={normalized.cuisineOrigin}
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
  closeButton: {
    position: "absolute",
    right: Spacing.md,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
