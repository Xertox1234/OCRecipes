import React, { useCallback } from "react";
import { StyleSheet, View, Pressable, FlatList } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";
import {
  useFavouriteRecipes,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { resolveImageUrl } from "@/lib/query-client";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { ResolvedFavouriteRecipe } from "@shared/schema";

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export default function FavouriteRecipesScreen() {
  const navigation = useNavigation<NavProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const { data, isLoading, refetch, isRefetching } = useFavouriteRecipes();
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();

  const handleRecipePress = useCallback(
    (recipe: ResolvedFavouriteRecipe) => {
      haptics.selection();
      navigation.navigate("FeaturedRecipeDetail", {
        recipeId: recipe.recipeId,
        recipeType: recipe.recipeType === "mealPlan" ? "mealPlan" : "community",
      });
    },
    [haptics, navigation],
  );

  const handleUnfavourite = useCallback(
    (recipe: ResolvedFavouriteRecipe) => {
      haptics.impact();
      toggleFavourite({
        recipeId: recipe.recipeId,
        recipeType: recipe.recipeType,
      });
    },
    [haptics, toggleFavourite],
  );

  const renderItem = useCallback(
    ({ item }: { item: ResolvedFavouriteRecipe }) => {
      const imageUri = resolveImageUrl(item.imageUrl);
      return (
        <Pressable
          onPress={() => handleRecipePress(item)}
          style={[
            styles.recipeCard,
            { backgroundColor: withOpacity(theme.text, 0.04) },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}${item.recipeType === "community" ? ", community recipe" : ""}`}
        >
          <FallbackImage
            source={{ uri: imageUri ?? undefined }}
            style={styles.recipeImage}
            fallbackStyle={{
              ...styles.recipePlaceholder,
              backgroundColor: withOpacity(theme.text, 0.08),
            }}
            fallbackIcon="image"
            fallbackIconSize={20}
            fallbackIconColor={withOpacity(theme.text, 0.3)}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.recipeContent}>
            <ThemedText style={styles.recipeTitle} numberOfLines={2}>
              {item.title}
            </ThemedText>
            <View style={styles.recipeMeta}>
              <View
                style={[
                  styles.typeBadge,
                  {
                    backgroundColor: withOpacity(
                      item.recipeType === "community"
                        ? theme.link
                        : theme.success,
                      0.12,
                    ),
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.typeBadgeText,
                    {
                      color:
                        item.recipeType === "community"
                          ? theme.link
                          : theme.success,
                    },
                  ]}
                >
                  {item.recipeType === "community" ? "Community" : "Personal"}
                </ThemedText>
              </View>
              {item.difficulty && (
                <ThemedText
                  style={[
                    styles.recipeMetaText,
                    { color: theme.textSecondary },
                  ]}
                >
                  {item.difficulty}
                </ThemedText>
              )}
            </View>
          </View>
          <Pressable
            onPress={() => handleUnfavourite(item)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.title} from favourites`}
          >
            <Ionicons name="heart" size={20} color={theme.error} />
          </Pressable>
        </Pressable>
      );
    },
    [theme, handleRecipePress, handleUnfavourite],
  );

  const keyExtractor = useCallback(
    (item: ResolvedFavouriteRecipe) => `${item.recipeId}-${item.recipeType}`,
    [],
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight + Spacing.lg,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <View style={styles.skeletons}>
          {[1, 2, 3].map((i) => (
            <SkeletonBox
              key={i}
              width="100%"
              height={80}
              borderRadius={12}
              style={{ marginBottom: Spacing.md }}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={data ?? []}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        onRefresh={refetch}
        refreshing={isRefetching}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons
              name="heart-outline"
              size={48}
              color={withOpacity(theme.text, 0.2)}
            />
            <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
              No Favourites
            </ThemedText>
            <ThemedText
              style={[styles.emptySubtitle, { color: theme.textSecondary }]}
            >
              Recipes you favourite will appear here.
            </ThemedText>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skeletons: {
    padding: Spacing.lg,
  },
  recipeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.md,
  },
  recipeImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
    marginRight: Spacing.md,
  },
  recipePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  recipeContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  recipeTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: 4,
  },
  recipeMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  typeBadgeText: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
  },
  recipeMetaText: {
    fontSize: 12,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
