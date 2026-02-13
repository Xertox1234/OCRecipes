import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  RefreshControl,
  Image,
  TextInput,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { TrendingTags } from "@/components/TrendingTags";
import { HomeRecipeCard } from "@/components/HomeRecipeCard";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  FAB_CLEARANCE,
  withOpacity,
} from "@/constants/theme";
import type { CommunityRecipe } from "@shared/schema";
import type { HomeScreenNavigationProp } from "@/types/navigation";

const AVATAR_SIZE = 28;

function HomeSkeleton() {
  return (
    <View accessibilityElementsHidden>
      <SkeletonBox
        width={120}
        height={20}
        style={{ marginBottom: Spacing.xl }}
      />
      <SkeletonBox
        width="80%"
        height={28}
        style={{ marginBottom: Spacing["2xl"] }}
      />
      {/* Tag skeletons */}
      <View style={styles.skeletonTags}>
        <SkeletonBox width={80} height={32} borderRadius={28} />
        <SkeletonBox width={70} height={32} borderRadius={28} />
        <SkeletonBox width={75} height={32} borderRadius={28} />
        <SkeletonBox width={65} height={32} borderRadius={28} />
      </View>
      {/* Card skeletons */}
      <SkeletonBox
        width="100%"
        height={260}
        borderRadius={15}
        style={{ marginBottom: Spacing.lg }}
      />
      <SkeletonBox width="100%" height={260} borderRadius={15} />
    </View>
  );
}

function EmptyRecipes() {
  const { theme } = useTheme();

  return (
    <View style={styles.emptyContainer}>
      <Feather name="book-open" size={48} color={theme.textSecondary} />
      <ThemedText type="h4" style={styles.emptyTitle}>
        No recipes yet
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.emptyText, { color: theme.textSecondary }]}
      >
        Check back soon for featured recipes
      </ThemedText>
    </View>
  );
}

const INITIAL_RECIPE_COUNT = 3;
const EXPANDED_RECIPE_COUNT = 6;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { user } = useAuthContext();
  const navigation = useNavigation<HomeScreenNavigationProp>();

  const {
    data: recipes,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<CommunityRecipe[]>({
    queryKey: ["/api/recipes/featured"],
    enabled: !!user,
  });

  const [searchText, setSearchText] = useState("");
  const [showMore, setShowMore] = useState(false);

  const handleSearchSubmit = useCallback(() => {
    const query = searchText.trim();
    if (!query) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("MealPlanTab", {
      screen: "RecipeBrowser",
      params: { searchQuery: query },
    });
    setSearchText("");
  }, [searchText, haptics, navigation]);

  const handleTagPress = useCallback(
    (tag: string) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("MealPlanTab", {
        screen: "RecipeBrowser",
        params: { searchQuery: tag },
      });
    },
    [haptics, navigation],
  );

  const handleRecipePress = useCallback(
    (recipeId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("FeaturedRecipeDetail", { recipeId });
    },
    [haptics, navigation],
  );

  const handleFavourite = useCallback(
    (_recipeId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    },
    [haptics],
  );

  const handleSeeMore = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    setShowMore(true);
  }, [haptics]);

  const handleBrowseCatalog = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("MealPlanTab", {
      screen: "RecipeBrowser",
      params: {},
    });
  }, [haptics, navigation]);

  const displayName = user?.displayName || user?.username || "there";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: insets.top + Spacing.lg,
        paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={theme.success}
        />
      }
    >
      {isLoading ? (
        <View style={styles.skeletonContainer}>
          <HomeSkeleton />
        </View>
      ) : (
        <>
          {/* Header row: avatar + greeting + bell */}
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInDown.delay(50).duration(400)
            }
            style={styles.headerRow}
          >
            <View style={styles.headerLeft}>
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
              ) : (
                <View
                  style={[
                    styles.avatarPlaceholder,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Feather name="user" size={14} color={theme.textSecondary} />
                </View>
              )}
              <ThemedText type="body" style={styles.greeting}>
                Hello {displayName}
              </ThemedText>
            </View>
            <Feather name="bell" size={22} color={theme.textSecondary} />
          </Animated.View>

          {/* Headline */}
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInDown.delay(100).duration(400)
            }
            style={styles.headlineContainer}
          >
            <ThemedText type="h4" style={styles.headline}>
              What Would You Like{"\n"}To Cook Today?
            </ThemedText>
          </Animated.View>

          {/* Search bar */}
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInDown.delay(120).duration(400)
            }
            style={styles.searchContainer}
          >
            <View
              style={[
                styles.searchBar,
                { backgroundColor: withOpacity(theme.text, 0.06) },
              ]}
            >
              <Feather name="search" size={16} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search recipes..."
                placeholderTextColor={theme.textSecondary}
                value={searchText}
                onChangeText={setSearchText}
                onSubmitEditing={handleSearchSubmit}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search recipes"
              />
              {searchText.length > 0 && (
                <Pressable
                  onPress={() => setSearchText("")}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Feather name="x" size={16} color={theme.textSecondary} />
                </Pressable>
              )}
            </View>
          </Animated.View>

          {/* Trending tags */}
          <TrendingTags onTagPress={handleTagPress} />

          {/* Recipes section */}
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInDown.delay(200).duration(400)
            }
            style={styles.sectionHeader}
          >
            <ThemedText type="body" style={styles.sectionTitle}>
              Recipes For You
            </ThemedText>
          </Animated.View>

          {recipes && recipes.length > 0 ? (
            <>
              {recipes
                .slice(
                  0,
                  showMore ? EXPANDED_RECIPE_COUNT : INITIAL_RECIPE_COUNT,
                )
                .map((recipe, index) => (
                  <HomeRecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    index={index}
                    onPress={handleRecipePress}
                    onFavourite={handleFavourite}
                  />
                ))}

              {!showMore && recipes.length > INITIAL_RECIPE_COUNT ? (
                <Pressable
                  onPress={handleSeeMore}
                  style={styles.linkButton}
                  accessibilityRole="button"
                  accessibilityLabel="See more recipes"
                >
                  <ThemedText
                    type="body"
                    style={[styles.linkText, { color: theme.link }]}
                  >
                    See More
                  </ThemedText>
                  <Feather name="chevron-down" size={16} color={theme.link} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={handleBrowseCatalog}
                  style={styles.linkButton}
                  accessibilityRole="button"
                  accessibilityLabel="Browse recipe catalog"
                >
                  <ThemedText
                    type="body"
                    style={[styles.linkText, { color: theme.link }]}
                  >
                    Browse Recipe Catalog
                  </ThemedText>
                  <Feather name="chevron-right" size={16} color={theme.link} />
                </Pressable>
              )}
            </>
          ) : (
            <EmptyRecipes />
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  greeting: {
    fontFamily: FontFamily.medium,
  },
  headlineContainer: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  headline: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    lineHeight: 28,
  },
  searchContainer: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.card,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    padding: 0,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.lg,
  },
  emptyTitle: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    textAlign: "center",
  },
  skeletonContainer: {
    paddingHorizontal: Spacing.lg,
  },
  skeletonTags: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing["2xl"],
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  linkText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
  },
});
