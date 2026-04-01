import React, { useCallback, useRef } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import { CarouselRecipeCard, CARD_WIDTH } from "./CarouselRecipeCard";
import { CarouselSkeleton } from "./CarouselSkeleton";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  useCarouselRecipes,
  useSaveCarouselRecipe,
  useDismissCarouselRecipe,
} from "@/hooks/useCarouselRecipes";
import { Spacing, FontFamily } from "@/constants/theme";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";
import type { HomeScreenNavigationProp } from "@/types/navigation";

const SNAP_INTERVAL = CARD_WIDTH + Spacing.md;

export const RecipeCarousel = React.memo(function RecipeCarousel() {
  const { theme } = useTheme();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { data, isLoading } = useCarouselRecipes();
  const saveRecipe = useSaveCarouselRecipe();
  const dismissRecipe = useDismissCarouselRecipe();
  const savedIdsRef = useRef<Set<string>>(new Set());

  const cards = data?.cards ?? [];

  const handlePress = useCallback(
    (card: CarouselCardType) => {
      if (card.source === "community" && "id" in card.recipeData) {
        const communityId =
          typeof card.recipeData.id === "number"
            ? card.recipeData.id
            : parseInt(String(card.recipeData.id), 10);
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: communityId,
          recipeType: "community",
        });
      } else {
        // AI and catalog cards — pass full card data for inline display
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: 0,
          carouselCard: card,
        });
      }
    },
    [navigation],
  );

  const handleSave = useCallback(
    (card: CarouselCardType) => {
      savedIdsRef.current.add(card.id);
      const recipeData = card.recipeData;
      saveRecipe.mutate({
        recipeId: card.id,
        source: card.source,
        title: card.title,
        description:
          "description" in recipeData
            ? ((recipeData.description as string) ?? undefined)
            : undefined,
        instructions:
          "instructions" in recipeData
            ? ((recipeData.instructions as string[]) ?? undefined)
            : undefined,
        difficulty:
          "difficulty" in recipeData
            ? ((recipeData.difficulty as string) ?? undefined)
            : undefined,
        timeEstimate:
          "timeEstimate" in recipeData
            ? ((recipeData.timeEstimate as string) ?? undefined)
            : undefined,
      });
    },
    [saveRecipe],
  );

  const handleDismiss = useCallback(
    (card: CarouselCardType) => {
      dismissRecipe.mutate({ recipeId: card.id, source: card.source });
    },
    [dismissRecipe],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CarouselCardType>) => (
      <CarouselRecipeCard
        card={item}
        onPress={handlePress}
        onSave={handleSave}
        onDismiss={handleDismiss}
        isSaved={savedIdsRef.current.has(item.id)}
      />
    ),
    [handlePress, handleSave, handleDismiss],
  );

  const keyExtractor = useCallback((item: CarouselCardType) => item.id, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: SNAP_INTERVAL,
      offset: SNAP_INTERVAL * index,
      index,
    }),
    [],
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ThemedText type="body" style={[styles.header, { color: theme.text }]}>
          For You
        </ThemedText>
        <CarouselSkeleton />
      </View>
    );
  }

  if (cards.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} accessibilityRole="list">
      <ThemedText type="body" style={[styles.header, { color: theme.text }]}>
        For You
      </ThemedText>
      <FlatList
        data={cards}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        contentContainerStyle={styles.listContent}
        getItemLayout={getItemLayout}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  header: {
    fontFamily: FontFamily.semiBold,
    fontSize: 17,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
});
