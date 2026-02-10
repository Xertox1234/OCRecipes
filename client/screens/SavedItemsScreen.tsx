import React, { useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { SavedItemCard } from "@/components/SavedItemCard";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useSavedItems, useSavedItemCount } from "@/hooks/useSavedItems";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, withOpacity } from "@/constants/theme";
import type { SavedItem } from "@shared/schema";

const ITEM_SEPARATOR_HEIGHT = Spacing.md;

/** Cap staggered animation index to avoid slow entrance on long lists */
const MAX_ANIMATED_INDEX = 10;

export default function SavedItemsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { isPremium, features } = usePremiumContext();

  const {
    data: savedItems,
    isLoading,
    refetch,
    isRefetching,
  } = useSavedItems();
  const { data: countData } = useSavedItemCount();

  const itemCount = countData?.count ?? 0;
  const limit = isPremium ? null : features.maxSavedItems;

  const renderItem = useCallback(
    ({ item, index }: { item: SavedItem; index: number }) => (
      <Animated.View
        entering={
          reducedMotion
            ? undefined
            : FadeInDown.delay(
                Math.min(index, MAX_ANIMATED_INDEX) * 50,
              ).duration(300)
        }
      >
        <SavedItemCard item={item} />
      </Animated.View>
    ),
    [reducedMotion],
  );

  const renderSeparator = useCallback(
    () => <View style={{ height: ITEM_SEPARATOR_HEIGHT }} />,
    [],
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Feather name="bookmark" size={48} color={theme.textSecondary} />
      <ThemedText
        type="h4"
        style={[styles.emptyTitle, { color: theme.textSecondary }]}
      >
        No Saved Items
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.emptyText, { color: theme.textSecondary }]}
      >
        Save recipes and activities from your scan history to access them here.
      </ThemedText>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <ThemedText type="h3">My Library</ThemedText>
        {limit !== null ? (
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {itemCount} / {limit} items
          </ThemedText>
        ) : (
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {itemCount} items
          </ThemedText>
        )}
      </View>
      {!isPremium && itemCount >= features.maxSavedItems ? (
        <View
          style={[
            styles.limitBanner,
            { backgroundColor: withOpacity(theme.warning, 0.12) },
          ]}
        >
          <Feather name="alert-circle" size={16} color={theme.warning} />
          <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
            You&apos;ve reached the free limit. Upgrade to Premium for unlimited
            saves.
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  if (isLoading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.link} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={savedItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        ItemSeparatorComponent={renderSeparator}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
          !savedItems?.length && styles.emptyListContent,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={theme.link}
            progressViewOffset={headerHeight}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  emptyListContent: {
    flex: 1,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  limitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Spacing.sm,
    marginTop: Spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  emptyTitle: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    textAlign: "center",
  },
});
