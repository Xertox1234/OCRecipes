import React, { useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  RefreshControl,
  Image,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useAuthContext } from "@/context/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import type { HistoryScreenNavigationProp } from "@/types/navigation";

// API response types (dates come as strings over JSON)
type ScannedItemResponse = {
  id: number;
  productName: string;
  brandName?: string | null;
  calories?: string | null;
  imageUrl?: string | null;
  scannedAt: string;
};

type PaginatedResponse = {
  items: ScannedItemResponse[];
  total: number;
};

const PAGE_SIZE = 50;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const HistoryItem = React.memo(function HistoryItem({
  item,
  index,
  onPress,
}: {
  item: ScannedItemResponse;
  index: number;
  onPress: (item: ScannedItemResponse) => void;
}) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 150 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 150 });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffHours < 48) return "Yesterday";
    return date.toLocaleDateString();
  };

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={() => onPress(item)}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Card elevation={1} style={styles.itemCard}>
            <View style={styles.itemContent}>
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.itemImage}
                />
              ) : (
                <View
                  style={[
                    styles.itemPlaceholder,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Feather
                    name="package"
                    size={24}
                    color={theme.textSecondary}
                  />
                </View>
              )}

              <View style={styles.itemInfo}>
                <ThemedText
                  type="body"
                  style={styles.itemName}
                  numberOfLines={1}
                >
                  {item.productName}
                </ThemedText>
                {item.brandName ? (
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                    numberOfLines={1}
                  >
                    {item.brandName}
                  </ThemedText>
                ) : null}
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
                >
                  {formatDate(item.scannedAt)}
                </ThemedText>
              </View>

              <View style={styles.itemCalories}>
                <ThemedText
                  type="h4"
                  style={{ color: Colors.light.calorieAccent }}
                >
                  {item.calories ? Math.round(parseFloat(item.calories)) : "--"}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  kcal
                </ThemedText>
              </View>

              <Feather
                name="chevron-right"
                size={20}
                color={theme.textSecondary}
              />
            </View>
          </Card>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
});

// Memoized separator component to prevent re-renders
const ItemSeparator = React.memo(function ItemSeparator() {
  return <View style={{ height: Spacing.md }} />;
});

function EmptyState() {
  const { theme } = useTheme();

  return (
    <View style={styles.emptyContainer}>
      <Image
        source={require("../../assets/images/empty-history.png")}
        style={styles.emptyImage}
        resizeMode="contain"
      />
      <ThemedText type="h4" style={styles.emptyTitle}>
        No scans yet
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.emptyText, { color: theme.textSecondary }]}
      >
        Start scanning barcodes or nutrition labels to track your food
      </ThemedText>
    </View>
  );
}

function LoadingSkeleton() {
  const { theme } = useTheme();

  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={[
            styles.skeletonItem,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <View
            style={[
              styles.skeletonImage,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          />
          <View style={styles.skeletonText}>
            <View
              style={[
                styles.skeletonLine,
                { backgroundColor: theme.backgroundSecondary, width: "70%" },
              ]}
            />
            <View
              style={[
                styles.skeletonLine,
                { backgroundColor: theme.backgroundSecondary, width: "40%" },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function LoadingFooter() {
  const { theme } = useTheme();
  return (
    <View style={styles.loadingFooter}>
      <ActivityIndicator size="small" color={theme.textSecondary} />
    </View>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<HistoryScreenNavigationProp>();
  const { user } = useAuthContext();

  const {
    data,
    isLoading,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/scanned-items"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<PaginatedResponse> => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/scanned-items", baseUrl);
      url.searchParams.set("limit", PAGE_SIZE.toString());
      url.searchParams.set("offset", String(pageParam));

      const headers: Record<string, string> = {};
      const token = await tokenStorage.get();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce(
        (sum, page) => sum + page.items.length,
        0,
      );
      if (loadedCount < lastPage.total) {
        return loadedCount;
      }
      return undefined;
    },
    enabled: !!user,
  });

  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );

  const handleItemPress = useCallback(
    (item: ScannedItemResponse) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("ItemDetail", { itemId: item.id });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ScannedItemResponse; index: number }) => (
      <HistoryItem item={item} index={index} onPress={handleItemPress} />
    ),
    [handleItemPress],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={[
        styles.listContent,
        {
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: tabBarHeight + Spacing.xl,
        },
        items.length === 0 && !isLoading && styles.emptyListContent,
      ]}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      data={isLoading ? [] : items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id.toString()}
      ListEmptyComponent={isLoading ? <LoadingSkeleton /> : <EmptyState />}
      ListFooterComponent={isFetchingNextPage ? <LoadingFooter /> : null}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={Colors.light.success}
        />
      }
      ItemSeparatorComponent={ItemSeparator}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  itemCard: {
    padding: Spacing.lg,
  },
  itemContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  itemImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
  },
  itemPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontWeight: "600",
  },
  itemCalories: {
    alignItems: "flex-end",
    marginRight: Spacing.xs,
  },
  emptyContainer: {
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  emptyImage: {
    width: 180,
    height: 180,
    marginBottom: Spacing["2xl"],
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  emptyText: {
    textAlign: "center",
    maxWidth: 280,
  },
  skeletonContainer: {
    gap: Spacing.md,
  },
  skeletonItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius["2xl"],
    gap: Spacing.md,
  },
  skeletonImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
  },
  skeletonText: {
    flex: 1,
    gap: Spacing.sm,
  },
  skeletonLine: {
    height: 16,
    borderRadius: 4,
  },
  loadingFooter: {
    paddingVertical: Spacing.lg,
    alignItems: "center",
  },
});
