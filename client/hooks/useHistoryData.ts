import { useCallback, useMemo, useState } from "react";
import { Alert, Share } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
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
import type { ScannedItemResponse, PaginatedResponse } from "@/types/api";

const PAGE_SIZE = 50;

export function useHistoryData() {
  const navigation = useNavigation<ScanHistoryNavigationProp>();
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

  // Full history with infinite scroll
  const {
    data,
    isLoading: historyLoading,
    isError: historyError,
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

  // Only surface the error state when there is no cached data to show, so a
  // background-refetch failure over stale data does not blank an
  // otherwise-usable screen.
  const isError = historyError && allItems.length === 0;

  const handleRefresh = useCallback(async () => {
    setExpandedItemId(null);
    await refetch();
    haptics.impact();
  }, [refetch, haptics]);

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
      // The toggle is optimistic, so the heart flips at tap: favouriting is
      // a Success moment, unfavouriting a light tap. Read from the cache at
      // tap time so this callback stays stable for the memoised rows.
      const wasFavourited = queryClient
        .getQueryData<{ pages: PaginatedResponse<ScannedItemResponse>[] }>(
          QUERY_KEYS.scannedItems,
        )
        ?.pages.flatMap((page) => page.items)
        .find((item) => item.id === itemId)?.isFavourited;
      if (wasFavourited === false) {
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      } else {
        haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      }
      toggleFavourite.mutate(itemId);
    },
    [queryClient, haptics, toggleFavourite],
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
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    // State
    expandedItemId,
    upgradeModalVisible,
    setUpgradeModalVisible,
    groceryPickerVisible,
    setGroceryPickerVisible,
    groceryItemName,
    reducedMotion,
    isPremium,

    // Data
    displayItems: allItems,
    isLoading: historyLoading,
    isError,
    isRefetching,
    isFetchingNextPage,
    favouritePendingItemId,
    discardPendingItemId,

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
    handleScrollBeginDrag,
    handleEndReached,
  };
}
