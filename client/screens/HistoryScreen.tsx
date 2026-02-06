import React, { useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  RefreshControl,
  Image,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import { SkeletonList, SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import type { TodayDashboardNavigationProp } from "@/types/navigation";
import type { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";
import type {
  ScannedItemResponse,
  PaginatedResponse,
  DailySummaryResponse,
} from "@/types/api";
import type { RouteProp } from "@react-navigation/native";

const PAGE_SIZE = 50;
const DASHBOARD_ITEM_LIMIT = 5;

/** Item height for getItemLayout optimization (padding + content + padding) */
const ITEM_HEIGHT = Spacing.lg * 2 + 56; // 88px
const SEPARATOR_HEIGHT = Spacing.md; // 12px

const HistoryItem = React.memo(function HistoryItem({
  item,
  index,
  onPress,
  reducedMotion,
}: {
  item: ScannedItemResponse;
  index: number;
  onPress: (item: ScannedItemResponse) => void;
  reducedMotion: boolean;
}) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!reducedMotion) {
      scale.value = withSpring(0.98, pressSpringConfig);
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion) {
      scale.value = withSpring(1, pressSpringConfig);
    }
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

  const calorieText = item.calories
    ? `${Math.round(parseFloat(item.calories))} calories`
    : "calories unknown";

  // Skip entrance animation when reduced motion is preferred
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(index * 50).duration(300);

  return (
    <Animated.View entering={enteringAnimation}>
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={() => onPress(item)}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          accessibilityLabel={`${item.productName}${item.brandName ? ` by ${item.brandName}` : ""}, ${calorieText}. Tap to view details.`}
          accessibilityRole="button"
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
                <ThemedText type="h4" style={{ color: theme.calorieAccent }}>
                  {item.calories ? Math.round(parseFloat(item.calories)) : "—"}
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

function LoadingFooter() {
  const { theme } = useTheme();
  return (
    <View
      style={styles.loadingFooter}
      accessibilityLiveRegion="polite"
      accessibilityLabel="Loading more items"
    >
      <ActivityIndicator size="small" color={theme.textSecondary} />
    </View>
  );
}

function DashboardSkeleton() {
  return (
    <View accessibilityElementsHidden>
      {/* Stats row skeleton */}
      <View style={styles.statsRow}>
        <SkeletonBox
          width="48%"
          height={100}
          borderRadius={BorderRadius["2xl"]}
        />
        <SkeletonBox
          width="48%"
          height={100}
          borderRadius={BorderRadius["2xl"]}
        />
      </View>
      {/* CTA skeleton */}
      <SkeletonBox
        width="100%"
        height={120}
        borderRadius={BorderRadius["2xl"]}
        style={{ marginTop: Spacing.xl }}
      />
      {/* Section header skeleton */}
      <SkeletonBox
        width={150}
        height={24}
        style={{ marginTop: Spacing["2xl"], marginBottom: Spacing.lg }}
      />
      {/* Recent items skeleton */}
      <SkeletonList count={3} />
    </View>
  );
}

/** Props for DashboardHeader component */
type DashboardHeaderProps = {
  userName: string;
  currentCalories: number;
  calorieGoal: number;
  calorieProgress: number;
  itemCount: number;
  reducedMotion: boolean;
  onScanPress: () => void;
};

const DashboardHeader = React.memo(function DashboardHeader({
  userName,
  currentCalories,
  calorieGoal,
  calorieProgress,
  itemCount,
  reducedMotion,
  onScanPress,
}: DashboardHeaderProps) {
  const { theme } = useTheme();

  return (
    <View>
      {/* Welcome */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(50).duration(300)
        }
      >
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          WELCOME BACK
        </ThemedText>
        <ThemedText type="h2" style={{ marginBottom: Spacing.xl }}>
          {userName}
        </ThemedText>
      </Animated.View>

      {/* Stats row */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(100).duration(300)
        }
        style={styles.statsRow}
      >
        {/* Calories card */}
        <Card
          elevation={1}
          style={[styles.statCard, { backgroundColor: theme.link }]}
        >
          <View
            accessible={true}
            accessibilityRole="text"
            accessibilityLabel={`Today's calories: ${currentCalories} of ${calorieGoal} consumed. ${Math.round(calorieProgress)} percent of daily goal.`}
          >
            <ThemedText
              type="caption"
              style={{ color: withOpacity(theme.buttonText, 0.8) }}
            >
              TODAY&apos;S CALORIES
            </ThemedText>
            <View style={styles.statValueRow}>
              <ThemedText type="h2" style={{ color: theme.buttonText }}>
                {currentCalories.toLocaleString()}
              </ThemedText>
              <ThemedText
                type="body"
                style={{
                  color: withOpacity(theme.buttonText, 0.8),
                  marginLeft: Spacing.xs,
                }}
              >
                / {calorieGoal.toLocaleString()}
              </ThemedText>
            </View>
          </View>
        </Card>

        {/* Items scanned card */}
        <Card
          elevation={1}
          style={[styles.statCard, { backgroundColor: theme.warning }]}
        >
          <View
            accessible={true}
            accessibilityRole="text"
            accessibilityLabel={`Items scanned today: ${itemCount}`}
          >
            <ThemedText
              type="caption"
              style={{ color: withOpacity(theme.buttonText, 0.8) }}
            >
              ITEMS SCANNED
            </ThemedText>
            <ThemedText type="h2" style={{ color: theme.buttonText }}>
              {itemCount}
            </ThemedText>
          </View>
        </Card>
      </Animated.View>

      {/* Scan CTA */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(150).duration(300)
        }
      >
        <Pressable
          style={[
            styles.scanCTA,
            { backgroundColor: theme.backgroundSecondary },
          ]}
          onPress={onScanPress}
          accessibilityRole="button"
          accessibilityLabel="Scan barcode. Opens camera to scan food barcode."
        >
          <View style={styles.scanCTAIcon}>
            <Feather name="camera" size={32} color={theme.text} />
          </View>
          <ThemedText type="h4" style={{ marginTop: Spacing.md }}>
            Scan Barcode
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            Identify food & get AI recipes
          </ThemedText>
        </Pressable>
      </Animated.View>

      {/* Recent History section header */}
      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(200).duration(300)
        }
        style={styles.sectionHeader}
      >
        <ThemedText type="h4">Recent History</ThemedText>
      </Animated.View>
    </View>
  );
});

/** Props for FullHistoryHeader component */
type FullHistoryHeaderProps = {
  onBackPress: () => void;
};

const FullHistoryHeader = React.memo(function FullHistoryHeader({
  onBackPress,
}: FullHistoryHeaderProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.fullHistoryHeader}>
      <Pressable
        onPress={onBackPress}
        style={styles.backButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Back to Today dashboard"
      >
        <Feather name="arrow-left" size={20} color={theme.link} />
        <ThemedText
          type="body"
          style={{ color: theme.link, marginLeft: Spacing.xs }}
        >
          Today
        </ThemedText>
      </Pressable>
      <ThemedText type="h4" style={{ marginTop: Spacing.md }}>
        All History
      </ThemedText>
    </View>
  );
});

/** Props for ViewAllFooter component */
type ViewAllFooterProps = {
  onViewAllPress: () => void;
};

const ViewAllFooter = React.memo(function ViewAllFooter({
  onViewAllPress,
}: ViewAllFooterProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.viewAllContainer}>
      <Pressable
        onPress={onViewAllPress}
        style={styles.viewAllLink}
        accessibilityRole="link"
        accessibilityLabel="View all history"
      >
        <ThemedText type="body" style={{ color: theme.link }}>
          View All History
        </ThemedText>
        <Feather
          name="arrow-right"
          size={16}
          color={theme.link}
          style={{ marginLeft: Spacing.xs }}
        />
      </Pressable>
    </View>
  );
});

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<TodayDashboardNavigationProp>();
  const route = useRoute<RouteProp<HistoryStackParamList, "History">>();
  const { user } = useAuthContext();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const queryClient = useQueryClient();

  // Determine if we're showing dashboard or full history
  const showAll = route.params?.showAll ?? false;

  // Dashboard queries (only when not showing all)
  const {
    data: todaySummary,
    isLoading: summaryLoading,
    isFetching: summaryFetching,
  } = useQuery<DailySummaryResponse>({
    queryKey: ["/api/daily-summary"],
    queryFn: async (): Promise<DailySummaryResponse> => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/daily-summary", baseUrl);

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
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: true,
    enabled: !!user && !showAll,
  });

  // Full history with infinite scroll (for showAll mode)
  const {
    data,
    isLoading: historyLoading,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/scanned-items"],
    initialPageParam: 0,
    queryFn: async ({
      pageParam,
    }): Promise<PaginatedResponse<ScannedItemResponse>> => {
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

  const allItems = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );

  // Items to display: limited for dashboard, all for full history
  const displayItems = showAll
    ? allItems
    : allItems.slice(0, DASHBOARD_ITEM_LIMIT);

  const isLoading = showAll ? historyLoading : historyLoading || summaryLoading;
  const isRefreshingDashboard = summaryFetching || isRefetching;

  // Coordinated pull-to-refresh for dashboard
  const handleRefresh = useCallback(async () => {
    if (!showAll) {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/daily-summary"] }),
        queryClient.refetchQueries({ queryKey: ["/api/scanned-items"] }),
      ]);
    } else {
      refetch();
    }
  }, [showAll, queryClient, refetch]);

  const handleItemPress = useCallback(
    (item: ScannedItemResponse) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("ItemDetail", { itemId: item.id });
    },
    [navigation, haptics],
  );

  const handleScanPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate("ScanTab");
  }, [navigation, haptics]);

  const handleViewAllPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.setParams({ showAll: true });
  }, [navigation, haptics]);

  const handleBackToDashboard = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.setParams({ showAll: false });
  }, [navigation, haptics]);

  const renderItem = useCallback(
    ({ item, index }: { item: ScannedItemResponse; index: number }) => (
      <HistoryItem
        item={item}
        index={index}
        onPress={handleItemPress}
        reducedMotion={reducedMotion}
      />
    ),
    [handleItemPress, reducedMotion],
  );

  const handleEndReached = useCallback(() => {
    if (showAll && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [showAll, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: ITEM_HEIGHT,
      offset: (ITEM_HEIGHT + SEPARATOR_HEIGHT) * index,
      index,
    }),
    [],
  );

  // Calculate calorie progress
  const calorieGoal = user?.dailyCalorieGoal || 2000;
  const currentCalories = Math.round(todaySummary?.totalCalories || 0);
  const calorieProgress = Math.min((currentCalories / calorieGoal) * 100, 100);
  const userName = user?.displayName || user?.username || "there";
  const itemCount = todaySummary?.itemCount || 0;

  // Render loading state for dashboard
  if (!showAll && isLoading) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: tabBarHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <DashboardSkeleton />
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={[
        styles.listContent,
        {
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: tabBarHeight + Spacing.xl,
        },
        displayItems.length === 0 && !isLoading && styles.emptyListContent,
      ]}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      data={isLoading ? [] : displayItems}
      renderItem={renderItem}
      keyExtractor={(item) => item.id.toString()}
      ListHeaderComponent={
        showAll ? (
          <FullHistoryHeader onBackPress={handleBackToDashboard} />
        ) : (
          <DashboardHeader
            userName={userName}
            currentCalories={currentCalories}
            calorieGoal={calorieGoal}
            calorieProgress={calorieProgress}
            itemCount={itemCount}
            reducedMotion={reducedMotion}
            onScanPress={handleScanPress}
          />
        )
      }
      ListEmptyComponent={
        isLoading ? (
          <View accessibilityElementsHidden>
            <SkeletonList count={5} />
          </View>
        ) : (
          <EmptyState />
        )
      }
      ListFooterComponent={
        showAll ? (
          isFetchingNextPage ? (
            <LoadingFooter />
          ) : null
        ) : displayItems.length > 0 ? (
          <ViewAllFooter onViewAllPress={handleViewAllPress} />
        ) : null
      }
      refreshControl={
        <RefreshControl
          refreshing={showAll ? isRefetching : isRefreshingDashboard}
          onRefresh={handleRefresh}
          tintColor={theme.success}
        />
      }
      ItemSeparatorComponent={ItemSeparator}
      getItemLayout={showAll ? getItemLayout : undefined}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      accessibilityLabel={
        showAll ? "Full scan history list" : "Today dashboard"
      }
      accessibilityRole="list"
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
  statsRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  statCard: {
    flex: 1,
    padding: Spacing.lg,
  },
  statValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: Spacing.sm,
  },
  scanCTA: {
    padding: Spacing.xl,
    borderRadius: BorderRadius["2xl"],
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  scanCTAIcon: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionHeader: {
    marginBottom: Spacing.lg,
  },
  fullHistoryHeader: {
    marginBottom: Spacing.lg,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  viewAllContainer: {
    alignItems: "center",
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  viewAllLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
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
  loadingFooter: {
    paddingVertical: Spacing.lg,
    alignItems: "center",
  },
});
