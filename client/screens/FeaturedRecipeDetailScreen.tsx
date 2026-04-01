import React, { useCallback, useMemo } from "react";
import { StyleSheet, View, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { RecipeDetailContent } from "@/components/RecipeDetailContent";
import { RecipeDetailSkeleton } from "@/components/recipe-detail";
import { resolveImageUrl } from "@/lib/query-client";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, withOpacity } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { CommunityRecipe } from "@shared/schema";
import type { CarouselRecipeCard } from "@shared/types/carousel";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

const CLOSE_BUTTON_SIZE = 44;

type FeaturedRecipeDetailRouteProp = RouteProp<
  RootStackParamList,
  "FeaturedRecipeDetail"
>;

function normalizeToCommunityRecipe(card: CarouselRecipeCard): CommunityRecipe {
  const data = card.recipeData;

  // AI-generated suggestions
  if (card.source === "ai") {
    const ai = data as MealSuggestion;
    return {
      id: 0,
      authorId: null,
      barcode: null,
      normalizedProductName: card.title.toLowerCase(),
      title: card.title,
      description: ai.description,
      difficulty: ai.difficulty,
      timeEstimate: ai.prepTimeMinutes ? `${ai.prepTimeMinutes} minutes` : null,
      servings: 2,
      dietTags: ai.dietTags,
      instructions: ai.instructions,
      ingredients: [],
      imageUrl: card.imageUrl,
      isPublic: true,
      likeCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // Community recipes
  if (card.source === "community" && "instructions" in data) {
    return data as unknown as CommunityRecipe;
  }

  // Catalog recipes (minimal data)
  return {
    id: 0,
    authorId: null,
    barcode: null,
    normalizedProductName: card.title.toLowerCase(),
    title: card.title,
    description: card.recommendationReason,
    difficulty: null,
    timeEstimate: card.prepTimeMinutes
      ? `${card.prepTimeMinutes} minutes`
      : null,
    servings: null,
    dietTags: [],
    instructions: [],
    ingredients: [],
    imageUrl: card.imageUrl,
    isPublic: true,
    likeCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export default function FeaturedRecipeDetailScreen() {
  const route = useRoute<FeaturedRecipeDetailRouteProp>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { recipeId, carouselCard } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const {
    data: fetchedRecipe,
    isLoading: isFetching,
    error,
  } = useQuery<CommunityRecipe>({
    queryKey: [`/api/recipes/${recipeId}`],
    enabled: !carouselCard,
  });

  const recipe: CommunityRecipe | undefined = carouselCard
    ? normalizeToCommunityRecipe(carouselCard)
    : fetchedRecipe;
  const isLoading = !carouselCard && isFetching;

  const dismiss = useCallback(() => navigation.goBack(), [navigation]);

  const imageUri = useMemo(
    () => resolveImageUrl(recipe?.imageUrl),
    [recipe?.imageUrl],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Close button — floats over hero image */}
      <View style={[styles.sheetHeader, { top: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          accessibilityLabel="Close"
          accessibilityRole="button"
          style={styles.closeButton}
        >
          <Feather name="chevron-down" size={20} color={theme.buttonText} />
        </Pressable>
      </View>

      {isLoading ? (
        <ScrollView contentInsetAdjustmentBehavior="never">
          <RecipeDetailSkeleton />
        </ScrollView>
      ) : error || !recipe ? (
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
          recipeType="community"
          title={recipe.title}
          description={recipe.description}
          imageUrl={imageUri}
          timeDisplay={recipe.timeEstimate}
          difficulty={recipe.difficulty}
          servings={recipe.servings}
          dietTags={recipe.dietTags ?? []}
          instructions={recipe.instructions}
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
  sheetHeader: {
    position: "absolute",
    right: Spacing.md,
    zIndex: 10,
  },
  closeButton: {
    width: CLOSE_BUTTON_SIZE,
    height: CLOSE_BUTTON_SIZE,
    borderRadius: CLOSE_BUTTON_SIZE / 2,
    backgroundColor: withOpacity("#000000", 0.4), // hardcoded — black overlay for close button
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
