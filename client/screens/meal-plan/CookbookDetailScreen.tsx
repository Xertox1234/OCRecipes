import React, { useCallback, useRef } from "react";
import { StyleSheet, View, Pressable, FlatList, Alert } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useCookbookDetail,
  useDeleteCookbook,
  useRemoveRecipeFromCookbook,
} from "@/hooks/useCookbooks";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { CookbookDetailScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { ResolvedCookbookRecipe } from "@shared/schema";

export default function CookbookDetailScreen() {
  const navigation = useNavigation<CookbookDetailScreenNavigationProp>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "CookbookDetail">>();
  const { cookbookId } = route.params;
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { data: cookbook, isLoading } = useCookbookDetail(cookbookId);
  const { mutate: deleteCookbook } = useDeleteCookbook();
  const { mutate: removeRecipe } = useRemoveRecipeFromCookbook();
  const isRemovingRef = useRef(false);

  const handleRemoveRecipe = useCallback(
    (recipe: ResolvedCookbookRecipe) => {
      if (isRemovingRef.current) return;
      isRemovingRef.current = true;

      removeRecipe(
        {
          cookbookId,
          recipeId: recipe.recipeId,
          recipeType: recipe.recipeType,
        },
        {
          onSettled: () => {
            isRemovingRef.current = false;
          },
        },
      );
    },
    [cookbookId, removeRecipe],
  );

  const handleRecipePress = useCallback(
    (recipe: ResolvedCookbookRecipe) => {
      haptics.selection();
      if (recipe.recipeType === "mealPlan") {
        navigation.navigate("RecipeDetail", { recipeId: recipe.recipeId });
      } else {
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: recipe.recipeId,
        });
      }
    },
    [haptics, navigation],
  );

  const handleAddRecipes = useCallback(() => {
    haptics.selection();
    navigation.navigate("RecipeBrowser", {});
  }, [haptics, navigation]);

  const handleEdit = useCallback(() => {
    navigation.navigate("CookbookCreate", { cookbookId });
  }, [navigation, cookbookId]);

  const handleDelete = useCallback(() => {
    if (!cookbook) return;
    Alert.alert(
      "Delete Cookbook",
      `Are you sure you want to delete "${cookbook.name}"? Recipes won't be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            haptics.impact();
            deleteCookbook(cookbookId, {
              onSuccess: () => navigation.goBack(),
            });
          },
        },
      ],
    );
  }, [cookbook, haptics, deleteCookbook, cookbookId, navigation]);

  const handleOverflowMenu = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Cookbook Options", undefined, [
      { text: "Edit", onPress: handleEdit },
      { text: "Delete", style: "destructive", onPress: handleDelete },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [haptics, handleEdit, handleDelete]);

  const handleConfirmRemove = useCallback(
    (recipe: ResolvedCookbookRecipe) => {
      Alert.alert(
        "Remove Recipe",
        `Remove "${recipe.title}" from this cookbook?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => handleRemoveRecipe(recipe),
          },
        ],
      );
    },
    [handleRemoveRecipe],
  );

  const renderItem = useCallback(
    ({ item }: { item: ResolvedCookbookRecipe }) => (
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
          source={{ uri: item.imageUrl ?? undefined }}
          style={styles.recipeImage}
          fallbackStyle={{
            ...styles.recipePlaceholder,
            backgroundColor: withOpacity(theme.text, 0.08),
          }}
          fallbackIcon="image"
          fallbackIconSize={20}
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
                style={[styles.recipeMetaText, { color: theme.textSecondary }]}
              >
                {item.difficulty}
              </ThemedText>
            )}
          </View>
        </View>
        <Pressable
          onPress={() => handleConfirmRemove(item)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.title}`}
        >
          <Feather name="trash-2" size={16} color={theme.textSecondary} />
        </Pressable>
      </Pressable>
    ),
    [theme, handleRecipePress, handleConfirmRemove],
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
        data={cookbook?.recipes || []}
        keyExtractor={(item) => `${item.recipeId}-${item.recipeType}`}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            {cookbook?.description ? (
              <ThemedText
                style={[styles.description, { color: theme.textSecondary }]}
              >
                {cookbook.description}
              </ThemedText>
            ) : null}
            <View style={styles.headerActions}>
              <Pressable
                onPress={handleAddRecipes}
                style={[
                  styles.addRecipesButton,
                  { backgroundColor: withOpacity(theme.link, 0.1) },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add recipes"
              >
                <Feather name="plus" size={14} color={theme.link} />
                <ThemedText
                  style={[styles.addRecipesText, { color: theme.link }]}
                >
                  Add Recipes
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={handleOverflowMenu}
                hitSlop={8}
                style={[
                  styles.overflowButton,
                  { backgroundColor: withOpacity(theme.text, 0.06) },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cookbook options"
              >
                <Feather name="more-horizontal" size={18} color={theme.text} />
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather
              name="book-open"
              size={48}
              color={withOpacity(theme.text, 0.2)}
            />
            <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
              No Recipes Yet
            </ThemedText>
            <ThemedText
              style={[styles.emptySubtitle, { color: theme.textSecondary }]}
            >
              Browse recipes and save your favorites here.
            </ThemedText>
            <Pressable
              onPress={handleAddRecipes}
              style={[styles.browseButton, { backgroundColor: theme.link }]}
              accessibilityRole="button"
              accessibilityLabel="Browse recipes"
            >
              <Feather name="search" size={16} color={theme.buttonText} />
              <ThemedText style={styles.browseButtonText}>
                Browse Recipes
              </ThemedText>
            </Pressable>
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
  header: {
    marginBottom: Spacing.lg,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  addRecipesButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  addRecipesText: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
  },
  overflowButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
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
    marginBottom: Spacing.xl,
  },
  browseButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  browseButtonText: {
    color: "#FFFFFF", // hardcoded — always white text on colored button
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
});
