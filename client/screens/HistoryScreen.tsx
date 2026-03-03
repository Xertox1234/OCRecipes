import React, {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  RefreshControl,
  Image,
  ActivityIndicator,
  ScrollView,
  AccessibilityInfo,
  Alert,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
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
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { SkeletonList, SkeletonBox } from "@/components/SkeletonLoader";
import { HistoryItemActions } from "@/components/HistoryItemActions";
import { UpgradeModal } from "@/components/UpgradeModal";
import { GroceryListPickerModal } from "@/components/GroceryListPickerModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { usePremiumContext } from "@/context/PremiumContext";
import { useToggleFavourite } from "@/hooks/useFavourites";
import { useDiscardItem } from "@/hooks/useDiscardItem";
import {
  Spacing,
  BorderRadius,
  withOpacity,
  FAB_CLEARANCE,
} from "@/constants/theme";
import { pressSpringConfig, expandTimingConfig } from "@/constants/animations";
import { getApiUrl } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { tokenStorage } from "@/lib/token-storage";
import type { ScanHistoryNavigationProp } from "@/types/navigation";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import type {
  ScannedItemResponse,
  PaginatedResponse,
  DailySummaryResponse,
} from "@/types/api";
import type { RouteProp } from "@react-navigation/native";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

const PAGE_SIZE = 50;
const DASHBOARD_ITEM_LIMIT = 5;

/** Height of the expanded action row */
const ACTION_ROW_HEIGHT = 90;

/**
 * Estimated height (px) of a collapsed history item card.
 * Used by getItemLayout to speed up FlatList scroll calculations.
 * Since only one item is expanded at a time, the vast majority use this height.
 * Breakdown: Card padding (16*2) + content-area padding (20*2) + image row (~56) = ~128
 */
const ESTIMATED_COLLAPSED_ITEM_HEIGHT = 128;

/** Height of the separator between items (Spacing.md) */
const ITEM_SEPARATOR_HEIGHT = Spacing.md;

/** Cap staggered animation index to avoid slow entrance on long lists */
const MAX_ANIMATED_INDEX = 10;

const HistoryItem = React.memo(function HistoryItem({
  item,
  index,
  expandedItemId,
  onToggleExpand,
  onNavigateToDetail,
  isPremium,
  onFavourite,
  onGroceryList,
  onGenerateRecipe,
  onShare,
  onDiscard,
  favouritePendingItemId,
  discardPendingItemId,
  reducedMotion,
}: {
  item: ScannedItemResponse;
  index: number;
  expandedItemId: number | null;
  onToggleExpand: (itemId: number) => void;
  onNavigateToDetail: (itemId: number) => void;
  isPremium: boolean;
  onFavourite: (itemId: number) => void;
  onGroceryList: (item: ScannedItemResponse) => void;
  onGenerateRecipe: (item: ScannedItemResponse) => void;
  onShare: (item: ScannedItemResponse) => void;
  onDiscard: (item: ScannedItemResponse) => void;
  favouritePendingItemId: number | undefined;
  discardPendingItemId: number | undefined;
  reducedMotion: boolean;
}) {
  // Compute derived state internally so renderItem doesn't depend on expandedItemId
  // or mutation state. FlatList's extraData triggers re-render; memo compares props.
  const isExpanded = expandedItemId === item.id;
  const isFavouriteLoading = favouritePendingItemId === item.id;
  const isDiscardLoading = discardPendingItemId === item.id;
  const { theme } = useTheme();
  const scale = useSharedValue(1);
  const expandHeight = useSharedValue(0);
  const chevronRotation = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      expandHeight.value = isExpanded ? ACTION_ROW_HEIGHT : 0;
      chevronRotation.value = isExpanded ? 90 : 0;
      return;
    }

    expandHeight.value = withTiming(
      isExpanded ? ACTION_ROW_HEIGHT : 0,
      expandTimingConfig,
    );
    chevronRotation.value = withTiming(isExpanded ? 90 : 0, expandTimingConfig);
  }, [isExpanded, expandHeight, chevronRotation, reducedMotion]);

  const animatedScale = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const animatedExpand = useAnimatedStyle(() => ({
    height: expandHeight.value,
    overflow: "hidden" as const,
  }));

  const animatedChevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
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

  const handlePress = () => {
    if (isExpanded) {
      onNavigateToDetail(item.id);
    } else {
      onToggleExpand(item.id);
    }
  };

  const calorieText = item.calories
    ? `${Math.round(parseFloat(item.calories))} calories`
    : "calories unknown";

  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(Math.min(index, MAX_ANIMATED_INDEX) * 50).duration(300);

  return (
    <Animated.View entering={enteringAnimation}>
      <Animated.View style={animatedScale}>
        <Card elevation={1} style={styles.itemCard}>
          <Pressable
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            accessibilityLabel={`${item.productName}${item.brandName && item.brandName !== "null" ? ` by ${item.brandName}` : ""}, ${calorieText}. ${isExpanded ? "Tap to view details." : "Tap to show actions."}`}
            accessibilityRole="button"
          >
            <View style={styles.itemContent}>
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.itemImage}
                  accessible={false}
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
                    accessible={false}
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
                {item.brandName && item.brandName !== "null" ? (
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                    numberOfLines={1}
                  >
                    {item.brandName}
                  </ThemedText>
                ) : null}
                {item.servingSize && item.servingSize !== "null" ? (
                  <ThemedText
                    type="caption"
                    style={{
                      color: theme.textSecondary,
                      marginTop: Spacing.xs,
                    }}
                  >
                    Serving: {item.servingSize}
                  </ThemedText>
                ) : null}
                {item.protein || item.carbs || item.fat ? (
                  <View style={styles.macroRow}>
                    {item.protein && !isNaN(parseFloat(item.protein)) ? (
                      <ThemedText
                        type="caption"
                        style={{ color: theme.proteinAccent }}
                      >
                        P {Math.round(parseFloat(item.protein))}g
                      </ThemedText>
                    ) : null}
                    {item.carbs && !isNaN(parseFloat(item.carbs)) ? (
                      <ThemedText
                        type="caption"
                        style={{ color: theme.carbsAccent }}
                      >
                        C {Math.round(parseFloat(item.carbs))}g
                      </ThemedText>
                    ) : null}
                    {item.fat && !isNaN(parseFloat(item.fat)) ? (
                      <ThemedText
                        type="caption"
                        style={{ color: theme.fatAccent }}
                      >
                        F {Math.round(parseFloat(item.fat))}g
                      </ThemedText>
                    ) : null}
                  </View>
                ) : null}
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

              <Animated.View style={animatedChevron}>
                <Feather
                  name="chevron-right"
                  size={20}
                  color={theme.textSecondary}
                />
              </Animated.View>
            </View>
          </Pressable>

          {/* Expandable actions area */}
          <Animated.View style={animatedExpand}>
            <HistoryItemActions
              isFavourited={item.isFavourited}
              isPremium={isPremium}
              isFavouriteLoading={isFavouriteLoading}
              isDiscardLoading={isDiscardLoading}
              onFavourite={() => onFavourite(item.id)}
              onGroceryList={() => onGroceryList(item)}
              onGenerateRecipe={() => onGenerateRecipe(item)}
              onShare={() => onShare(item)}
              onDiscard={() => onDiscard(item)}
            />
          </Animated.View>
        </Card>
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
        accessible={false}
        accessibilityElementsHidden={true}
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
  plannedCalories: number;
  reducedMotion: boolean;
  onScanPress: () => void;
};

const DashboardHeader = React.memo(function DashboardHeader({
  userName,
  currentCalories,
  calorieGoal,
  calorieProgress,
  itemCount,
  plannedCalories,
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
            accessibilityLabel={`Today's calories: ${currentCalories} of ${calorieGoal} consumed. ${Math.round(calorieProgress)} percent of daily goal.${plannedCalories > 0 ? ` ${plannedCalories} planned.` : ""}`}
          >
            <ThemedText
              type="caption"
              style={{ color: withOpacity(theme.buttonText, 0.8) }}
            >
              TODAY&apos;S CALORIES
            </ThemedText>
            <View style={styles.statValueRow}>
              <ThemedText
                type="h2"
                style={{ color: theme.buttonText }}
                maxFontSizeMultiplier={1.3}
              >
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
            {plannedCalories > 0 && (
              <ThemedText
                type="caption"
                style={{
                  color: withOpacity(theme.buttonText, 0.6),
                  marginTop: Spacing.xs,
                }}
              >
                {plannedCalories.toLocaleString()} planned
              </ThemedText>
            )}
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
            <ThemedText
              type="h2"
              style={{ color: theme.buttonText }}
              maxFontSizeMultiplier={1.3}
            >
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
          style={({ pressed }) => [
            styles.scanCTA,
            {
              backgroundColor: theme.backgroundSecondary,
              opacity: pressed ? 0.8 : 1,
            },
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
  // Safe fallback: returns 0 when not inside a bottom tab navigator (e.g. ProfileStack)
  const tabBarHeight = React.useContext(BottomTabBarHeightContext) ?? 0;
  const { theme } = useTheme();
  const navigation = useNavigation<ScanHistoryNavigationProp>();
  const route = useRoute<RouteProp<ProfileStackParamList, "ScanHistory">>();
  const { user } = useAuthContext();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const queryClient = useQueryClient();
  const { isPremium } = usePremiumContext();
  const toggleFavourite = useToggleFavourite();
  const discardItem = useDiscardItem();

  // Expanded accordion state
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [groceryPickerVisible, setGroceryPickerVisible] = useState(false);
  const [groceryItemName, setGroceryItemName] = useState("");

  // Determine if we're showing dashboard or full history
  const showAll = route.params?.showAll ?? false;

  // Dashboard queries (only when not showing all)
  const {
    data: todaySummary,
    isLoading: summaryLoading,
    isFetching: summaryFetching,
  } = useQuery<DailySummaryResponse>({
    queryKey: QUERY_KEYS.dailySummary,
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
    queryKey: QUERY_KEYS.scannedItems,
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
    setExpandedItemId(null);
    if (!showAll) {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.dailySummary }),
        queryClient.refetchQueries({ queryKey: QUERY_KEYS.scannedItems }),
      ]);
    } else {
      refetch();
    }
  }, [showAll, queryClient, refetch]);

  const handleToggleExpand = useCallback(
    (itemId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setExpandedItemId((prev) => (prev === itemId ? null : itemId));
    },
    [haptics],
  );

  const handleNavigateToDetail = useCallback(
    (itemId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("ItemDetail", { itemId });
    },
    [navigation, haptics],
  );

  const handleFavourite = useCallback(
    (itemId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      toggleFavourite.mutate(itemId);
    },
    [haptics, toggleFavourite],
  );

  const handleGroceryList = useCallback(
    (item: ScannedItemResponse) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setGroceryItemName(item.productName);
      setGroceryPickerVisible(true);
    },
    [haptics],
  );

  const handleGenerateRecipe = useCallback(
    (item: ScannedItemResponse) => {
      if (!isPremium) {
        haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
        setUpgradeModalVisible(true);
        return;
      }
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("MealPlanTab");
    },
    [isPremium, haptics, navigation],
  );

  const handleShare = useCallback(
    async (item: ScannedItemResponse) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      const calories = item.calories
        ? `${Math.round(parseFloat(item.calories))} kcal`
        : "";
      const brand =
        item.brandName && item.brandName !== "null" ? item.brandName : "";
      const content = [item.productName, brand, calories]
        .filter(Boolean)
        .join(" - ");

      try {
        await Share.share({ message: content, title: item.productName });
      } catch {
        // User cancelled
      }
    },
    [haptics],
  );

  const handleDiscard = useCallback(
    (item: ScannedItemResponse) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert(
        "Discard Item",
        `Remove "${item.productName}" from your history?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              setExpandedItemId(null);
              discardItem.mutate(item.id);
            },
          },
        ],
      );
    },
    [haptics, discardItem],
  );

  const handleScanPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate("Scan");
  }, [navigation, haptics]);

  const handleViewAllPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.setParams({ showAll: true });
  }, [navigation, haptics]);

  const handleBackToDashboard = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.setParams({ showAll: false });
  }, [navigation, haptics]);

  // Pending item IDs for mutation loading state — passed as scalars so
  // HistoryItem can compute its own loading booleans internally.
  const favouritePendingItemId = toggleFavourite.isPending
    ? toggleFavourite.variables
    : undefined;
  const discardPendingItemId = discardItem.isPending
    ? discardItem.variables
    : undefined;

  // Memoised extraData so FlatList re-renders items when expand or mutation
  // state changes, even though renderItem itself is not recreated.
  const extraData = useMemo(
    () => ({ expandedItemId, favouritePendingItemId, discardPendingItemId }),
    [expandedItemId, favouritePendingItemId, discardPendingItemId],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ScannedItemResponse; index: number }) => (
      <HistoryItem
        item={item}
        index={index}
        expandedItemId={expandedItemId}
        onToggleExpand={handleToggleExpand}
        onNavigateToDetail={handleNavigateToDetail}
        isPremium={isPremium}
        onFavourite={handleFavourite}
        onGroceryList={handleGroceryList}
        onGenerateRecipe={handleGenerateRecipe}
        onShare={handleShare}
        onDiscard={handleDiscard}
        favouritePendingItemId={favouritePendingItemId}
        discardPendingItemId={discardPendingItemId}
        reducedMotion={reducedMotion}
      />
    ),
    // expandedItemId and mutation pending state are intentionally excluded —
    // they change frequently and would force renderItem to be recreated for
    // every expand/collapse or mutation start/end. Instead, FlatList's
    // extraData triggers re-renders and React.memo on HistoryItem ensures
    // only affected items update.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reason: renderItem stability optimisation
    [
      handleToggleExpand,
      handleNavigateToDetail,
      isPremium,
      handleFavourite,
      handleGroceryList,
      handleGenerateRecipe,
      handleShare,
      handleDiscard,
      reducedMotion,
    ],
  );

  const handleScrollBeginDrag = useCallback(() => {
    setExpandedItemId(null);
  }, []);

  const handleEndReached = useCallback(() => {
    if (showAll && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [showAll, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Estimated layout using collapsed height — accurate for all but 1 expanded item
  const getItemLayout = useCallback(
    (
      _data: ArrayLike<ScannedItemResponse> | null | undefined,
      index: number,
    ) => ({
      length: ESTIMATED_COLLAPSED_ITEM_HEIGHT,
      offset: (ESTIMATED_COLLAPSED_ITEM_HEIGHT + ITEM_SEPARATOR_HEIGHT) * index,
      index,
    }),
    [],
  );

  // Calculate calorie progress
  const calorieGoal =
    user?.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;
  const currentCalories = Math.round(todaySummary?.totalCalories || 0);
  const calorieProgress = Math.min((currentCalories / calorieGoal) * 100, 100);
  const userName = user?.displayName || user?.username || "there";
  const itemCount = todaySummary?.itemCount || 0;
  const plannedCalories = Math.round(todaySummary?.plannedCalories || 0);

  // Announce calorie summary for screen readers once on dashboard load
  const hasAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!showAll && !isLoading && todaySummary && !hasAnnouncedRef.current) {
      hasAnnouncedRef.current = true;
      AccessibilityInfo.announceForAccessibility(
        `Today: ${currentCalories} of ${calorieGoal} calories, ${itemCount} items scanned`,
      );
    }
  }, [
    showAll,
    isLoading,
    todaySummary,
    currentCalories,
    calorieGoal,
    itemCount,
  ]);

  // Render loading state for dashboard
  if (!showAll && isLoading) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
          paddingHorizontal: Spacing.lg,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <DashboardSkeleton />
      </ScrollView>
    );
  }

  return (
    <>
      <FlatList
        style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
          },
          displayItems.length === 0 && !isLoading && styles.emptyListContent,
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        data={isLoading ? [] : displayItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        extraData={extraData}
        onScrollBeginDrag={handleScrollBeginDrag}
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
              plannedCalories={plannedCalories}
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
            tintColor={theme.link}
          />
        }
        ItemSeparatorComponent={ItemSeparator}
        getItemLayout={getItemLayout}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        accessibilityLabel={
          showAll ? "Full scan history list" : "Today dashboard"
        }
        accessibilityRole="list"
      />
      <UpgradeModal
        visible={upgradeModalVisible}
        onClose={() => setUpgradeModalVisible(false)}
      />
      <GroceryListPickerModal
        visible={groceryPickerVisible}
        onClose={() => setGroceryPickerVisible(false)}
        itemName={groceryItemName}
      />
    </>
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
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  itemImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
    alignSelf: "center",
  },
  itemPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontWeight: "600",
  },
  macroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
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
