import React, { useCallback } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  Pressable,
  Dimensions,
  type ListRenderItemInfo,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { CuratedBadge } from "@/components/CuratedBadge";
import { CarouselSkeleton } from "./CarouselSkeleton";
import { CARD_WIDTH } from "./CarouselRecipeCard";
import { useTheme } from "@/hooks/useTheme";
import { useCuratedRecipes } from "@/hooks/useCuratedRecipes";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { resolveImageUrl } from "@/lib/query-client";
import type { CommunityRecipe } from "@shared/schema";
import type { HomeScreenNavigationProp } from "@/types/navigation";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CURATED_CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.72);
const CURATED_IMAGE_HEIGHT = 120;
const SNAP_INTERVAL = CURATED_CARD_WIDTH + Spacing.md;

export const CuratedRecipeCarousel = React.memo(
  function CuratedRecipeCarousel() {
    const { theme } = useTheme();
    const navigation = useNavigation<HomeScreenNavigationProp>();
    const { data, isLoading } = useCuratedRecipes();

    const recipes = data?.recipes ?? [];

    const handlePress = useCallback(
      (recipe: CommunityRecipe) => {
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: recipe.id,
          recipeType: "community",
        });
      },
      [navigation],
    );

    const renderItem = useCallback(
      ({ item }: ListRenderItemInfo<CommunityRecipe>) => {
        const rawImage =
          (item.canonicalImages as string[] | null)?.[0] ?? item.imageUrl;
        const imageUri = resolveImageUrl(rawImage);

        return (
          <Pressable
            onPress={() => handlePress(item)}
            style={styles.cardWrapper}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. Curated recipe. Double tap to view.`}
            accessibilityHint="Opens recipe details"
          >
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.backgroundSecondary,
                  shadowColor: theme.text,
                },
              ]}
            >
              {/* Hero image */}
              <FallbackImage
                source={{ uri: imageUri }}
                style={styles.image}
                fallbackStyle={{
                  backgroundColor: withOpacity(theme.link, 0.08),
                }}
                fallbackIcon="book-open"
                fallbackIconSize={28}
                resizeMode="cover"
                accessible={false}
              />

              {/* CuratedBadge overlay */}
              <View style={styles.badgeContainer}>
                <CuratedBadge compact />
              </View>

              {/* Content */}
              <View style={styles.content}>
                <ThemedText
                  type="body"
                  style={[styles.title, { color: theme.text }]}
                  numberOfLines={2}
                >
                  {item.title}
                </ThemedText>
              </View>
            </View>
          </Pressable>
        );
      },
      [handlePress, theme],
    );

    const keyExtractor = useCallback(
      (item: CommunityRecipe) => String(item.id),
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
          <ThemedText
            type="body"
            style={[styles.header, { color: theme.text }]}
          >
            Curated Recipes
          </ThemedText>
          <CarouselSkeleton />
        </View>
      );
    }

    if (recipes.length === 0) {
      return null;
    }

    return (
      <View style={styles.container} accessibilityRole="list">
        <ThemedText type="body" style={[styles.header, { color: theme.text }]}>
          Curated Recipes
        </ThemedText>
        <FlatList
          data={recipes}
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
  },
);

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
  cardWrapper: {
    width: CURATED_CARD_WIDTH,
    marginRight: Spacing.md,
  },
  card: {
    borderRadius: BorderRadius.card,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  image: {
    width: "100%",
    height: CURATED_IMAGE_HEIGHT,
  },
  badgeContainer: {
    position: "absolute",
    top: Spacing.sm,
    left: Spacing.sm,
  },
  content: {
    padding: Spacing.md,
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
  },
});
