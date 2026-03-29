import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Share } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useToast } from "@/context/ToastContext";
import { useAuthContext } from "@/context/AuthContext";
import { usePremiumContext } from "@/context/PremiumContext";
import { useToggleFavourite } from "@/hooks/useFavourites";
import { useDiscardItem } from "@/hooks/useDiscardItem";
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

export function useHistoryData() {
  const navigation = useNavigation<ScanHistoryNavigationProp>();
  const route = useRoute<RouteProp<ProfileStackParamList, "ScanHistory">>();
  const { user } = useAuthContext();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const toast = useToast();
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
      await refetch();
    }
    haptics.impact();
  }, [showAll, queryClient, refetch, haptics]);

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
              discardItem.mutate(item.id, {
                onSuccess: () => {
                  toast.success("Item removed");
                },
              });
            },
          },
        ],
      );
    },
    [haptics, discardItem, toast],
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

  const handleScrollBeginDrag = useCallback(() => {
    setExpandedItemId(null);
  }, []);

  const handleEndReached = useCallback(() => {
    if (showAll && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [showAll, hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  return {
    // State
    expandedItemId,
    upgradeModalVisible,
    setUpgradeModalVisible,
    groceryPickerVisible,
    setGroceryPickerVisible,
    groceryItemName,
    showAll,
    reducedMotion,
    isPremium,

    // Data
    displayItems,
    isLoading,
    isRefetching,
    isRefreshingDashboard,
    isFetchingNextPage,
    favouritePendingItemId,
    discardPendingItemId,

    // Dashboard data
    userName,
    currentCalories,
    calorieGoal,
    calorieProgress,
    itemCount,
    plannedCalories,

    // Handlers
    handleRefresh,
    handleToggleExpand,
    handleNavigateToDetail,
    handleFavourite,
    handleGroceryList,
    handleGenerateRecipe,
    handleShare,
    handleDiscard,
    handleScanPress,
    handleViewAllPress,
    handleBackToDashboard,
    handleScrollBeginDrag,
    handleEndReached,
  };
}
