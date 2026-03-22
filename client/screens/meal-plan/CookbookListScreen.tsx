import React, { useCallback } from "react";
import { StyleSheet, View, Pressable, FlatList, Alert } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useCookbooks, useDeleteCookbook } from "@/hooks/useCookbooks";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { CookbookListScreenNavigationProp } from "@/types/navigation";
import type { CookbookWithCount } from "@shared/schema";

export default function CookbookListScreen() {
  const navigation = useNavigation<CookbookListScreenNavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { data: cookbooks, isLoading } = useCookbooks();
  const deleteMutation = useDeleteCookbook();

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
              deleteMutation.mutate(id);
            },
          },
        ],
      );
    },
    [haptics, deleteMutation],
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
        data={cookbooks || []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl + 56,
        }}
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
          </View>
        }
      />

      {/* FAB */}
      <Pressable
        onPress={() => {
          haptics.impact();
          navigation.navigate("CookbookCreate");
        }}
        style={[
          styles.fab,
          { backgroundColor: theme.link, bottom: tabBarHeight + Spacing.md },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Create new cookbook"
      >
        <Feather name="plus" size={24} color={theme.buttonText} />
      </Pressable>
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
  },
  fab: {
    position: "absolute",
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000", // hardcoded
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
