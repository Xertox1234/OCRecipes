import React, { useCallback, useMemo } from "react";
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
  useDismissCarouselRecipe,
} from "@/hooks/useCarouselRecipes";
import {
  useFavouriteRecipeIds,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import { Spacing, FontFamily } from "@/constants/theme";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";
import type { HomeScreenNavigationProp } from "@/types/navigation";

const SNAP_INTERVAL = CARD_WIDTH + Spacing.md;

export const RecipeCarousel = React.memo(function RecipeCarousel() {
  const { theme } = useTheme();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { data, isLoading } = useCarouselRecipes();
  const dismissRecipe = useDismissCarouselRecipe();
  const { data: favouriteData } = useFavouriteRecipeIds();
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();

  const cards = data?.cards ?? [];

  const favouriteIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const f of favouriteData?.ids ?? []) {
      set.add(`${f.recipeType}:${f.recipeId}`);
    }
    return set;
  }, [favouriteData]);

  const handlePress = useCallback(
    (card: CarouselCardType) => {
      navigation.navigate("FeaturedRecipeDetail", {
        recipeId: card.id,
        recipeType: "community",
      });
    },
    [navigation],
  );

  const handleDismiss = useCallback(
    (card: CarouselCardType) => {
      dismissRecipe.mutate({ recipeId: card.id });
    },
    [dismissRecipe],
  );

  const handleFavourite = useCallback(
    (recipeId: number) => {
      toggleFavourite({ recipeId, recipeType: "community" });
    },
    [toggleFavourite],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CarouselCardType>) => (
      <CarouselRecipeCard
        card={item}
        isFavourited={favouriteIdSet.has(`community:${item.id}`)}
        onPress={handlePress}
        onDismiss={handleDismiss}
        onFavourite={handleFavourite}
      />
    ),
    [handlePress, handleDismiss, handleFavourite, favouriteIdSet],
  );

  const keyExtractor = useCallback(
    (item: CarouselCardType) => String(item.id),
    [],
  );

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
