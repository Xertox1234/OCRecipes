import React, { useCallback, useLayoutEffect } from "react";
import { StyleSheet, View, Pressable, FlatList, Alert } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { Feather, Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useCookbooks, useDeleteCookbook } from "@/hooks/useCookbooks";
import { useFavouriteRecipeIds } from "@/hooks/useFavouriteRecipes";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { CookbookListScreenNavigationProp } from "@/types/navigation";
import type { CookbookWithCount } from "@shared/schema";

export default function CookbookListScreen() {
  const navigation = useNavigation<CookbookListScreenNavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { data: cookbooks, isLoading, refetch } = useCookbooks();
  const { mutate: deleteCookbook } = useDeleteCookbook();
  const { data: favouriteIds } = useFavouriteRecipeIds();
  const favouriteCount = favouriteIds?.ids.length ?? 0;

  // Refetch cookbook list (including recipe counts) when screen comes into focus,
  // since recipes may have been added from other screens in the stack
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  // Add "+" button in header instead of a FAB (avoids collision with Scan FAB)
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            haptics.impact();
            navigation.navigate("CookbookCreate");
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Create new cookbook"
          style={{ marginRight: Spacing.md }}
        >
          <Feather name="plus" size={24} color={theme.link} />
        </Pressable>
      ),
    });
  }, [navigation, haptics, theme.link]);

  const handleDelete = useCallback(
    (id: number, name: string) => {
      Alert.alert(
        "Delete Cookbook",
        `Are you sure you want to delete "${name}"? Recipes won't be deleted.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              haptics.impact();
              deleteCookbook(id);
            },
          },
        ],
      );
    },
    [haptics, deleteCookbook],
  );

  const renderItem = useCallback(
    ({ item }: { item: CookbookWithCount }) => (
      <Pressable
        onPress={() => {
          haptics.selection();
          navigation.navigate("CookbookDetail", { cookbookId: item.id });
        }}
        style={[
          styles.listItem,
          { backgroundColor: withOpacity(theme.text, 0.04) },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.recipeCount} recipes`}
      >
        <View style={styles.listItemContent}>
          <ThemedText style={styles.listItemTitle} numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText
            style={[styles.listItemMeta, { color: theme.textSecondary }]}
          >
            {item.recipeCount} {item.recipeCount === 1 ? "recipe" : "recipes"}
            {item.description ? ` · ${item.description}` : ""}
          </ThemedText>
        </View>
        <View style={styles.listItemActions}>
          <Pressable
            onPress={() => handleDelete(item.id, item.name)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.name}`}
          >
            <Feather name="trash-2" size={16} color={theme.textSecondary} />
          </Pressable>
          <Feather name="chevron-right" size={18} color={theme.textSecondary} />
        </View>
      </Pressable>
    ),
    [theme, haptics, navigation, handleDelete],
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
              height={64}
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
        data={cookbooks || []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        ListHeaderComponent={
          <Pressable
            onPress={() => {
              haptics.selection();
              navigation.navigate("FavouriteRecipes");
            }}
            style={[
              styles.listItem,
              { backgroundColor: withOpacity(theme.error, 0.06) },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Favourites, ${favouriteCount} recipes`}
          >
            <View style={styles.listItemContent}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: Spacing.sm,
                }}
              >
                <Ionicons name="heart" size={16} color={theme.error} />
                <ThemedText style={styles.listItemTitle}>Favourites</ThemedText>
              </View>
              <ThemedText
                style={[styles.listItemMeta, { color: theme.textSecondary }]}
              >
                {favouriteCount} {favouriteCount === 1 ? "recipe" : "recipes"}
              </ThemedText>
            </View>
            <View style={styles.listItemActions}>
              <Feather
                name="chevron-right"
                size={18}
                color={theme.textSecondary}
              />
            </View>
          </Pressable>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather
              name="book"
              size={48}
              color={withOpacity(theme.text, 0.2)}
            />
            <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
              No Cookbooks
            </ThemedText>
            <ThemedText
              style={[styles.emptySubtitle, { color: theme.textSecondary }]}
            >
              Create a cookbook to organize your favorite recipes.
            </ThemedText>
            <Pressable
              onPress={() => {
                haptics.impact();
                navigation.navigate("CookbookCreate");
              }}
              style={[styles.createButton, { backgroundColor: theme.link }]}
              accessibilityRole="button"
              accessibilityLabel="Create cookbook"
            >
              <Feather name="plus" size={16} color={theme.buttonText} />
              <ThemedText style={styles.createButtonText}>
                Create Cookbook
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
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.md,
  },
  listItemContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  listItemTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: 2,
  },
  listItemMeta: {
    fontSize: 13,
  },
  listItemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
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
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  createButtonText: {
    color: "#FFFFFF", // hardcoded — always white text on colored button
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
});
