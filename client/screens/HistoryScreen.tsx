import React, { useCallback, useMemo, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { SwipeableRow } from "@/components/SwipeableRow";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/SkeletonLoader";
import { HistoryItemActions } from "@/components/HistoryItemActions";
import { UpgradeModal } from "@/components/UpgradeModal";
import { GroceryListPickerModal } from "@/components/GroceryListPickerModal";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useHistoryData } from "@/hooks/useHistoryData";
import { useOfflineGuard } from "@/hooks/useOfflineGuard";
import { Spacing, BorderRadius } from "@/constants/theme";
import { pressSpringConfig, expandTimingConfig } from "@/constants/animations";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { ScannedItemResponse } from "@/types/api";
import { useDelayedLoadingAnnouncement } from "@/hooks/useDelayedLoadingAnnouncement";

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

  // A row opens its detail on the first tap (QA sweep #80); the actions area
  // is opened by the explicit chevron button beside it.
  const handlePress = () => onNavigateToDetail(item.id);

  const calorieText = item.calories
    ? `${Math.round(parseFloat(item.calories))} calories`
    : "calories unknown";

  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(Math.min(index, MAX_ANIMATED_INDEX) * 50).duration(300);

  return (
    <Animated.View entering={enteringAnimation}>
      <Animated.View style={animatedScale}>
        <SwipeableRow
          rightAction={{
            icon: "trash-2",
            label: "Discard",
            backgroundColor: theme.error,
            onAction: () => onDiscard(item),
          }}
          leftAction={{
            icon: item.isFavourited ? "heart" : "heart",
            label: item.isFavourited ? "Unfavourite" : "Favourite",
            backgroundColor: theme.accentSolid,
            onAction: () => onFavourite(item.id),
          }}
        >
          <Card elevation={1} style={styles.itemCard}>
            <View style={styles.itemContent}>
              <Pressable
                onPress={handlePress}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                style={styles.itemMain}
                accessibilityLabel={`${item.productName}${item.brandName && item.brandName !== "null" ? ` by ${item.brandName}` : ""}, ${calorieText}. Tap to view details.`}
                accessibilityRole="button"
              >
                <FallbackImage
                  source={{ uri: item.imageUrl ?? undefined }}
                  style={styles.itemImage}
                  fallbackStyle={{
                    ...styles.itemPlaceholder,
                    backgroundColor: theme.backgroundSecondary,
                  }}
                  fallbackIcon="package"
                  fallbackIconSize={24}
                  accessible={false}
                />

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
                    {item.calories
                      ? Math.round(parseFloat(item.calories))
                      : "—"}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    kcal
                  </ThemedText>
                </View>
              </Pressable>

              <Pressable
                onPress={() => onToggleExpand(item.id)}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                style={styles.expandButton}
                accessibilityRole="button"
                accessibilityLabel={`${isExpanded ? "Hide" : "Show"} actions for ${item.productName}`}
                accessibilityState={{ expanded: isExpanded }}
              >
                <Animated.View style={animatedChevron}>
                  <Feather
                    name="chevron-right"
                    size={20}
                    color={theme.textSecondary}
                    accessible={false}
                  />
                </Animated.View>
              </Pressable>
            </View>

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
        </SwipeableRow>
      </Animated.View>
    </Animated.View>
  );
});

// Memoized separator component to prevent re-renders
const ItemSeparator = React.memo(function ItemSeparator() {
  return <View style={{ height: Spacing.md }} />;
});

function HistoryEmptyState({ onScan }: { onScan?: () => void }) {
  return (
    <EmptyState
      variant="firstTime"
      icon="camera"
      title="No scans yet"
      description="Start scanning barcodes or nutrition labels to track your food"
      actionLabel="Scan Now"
      onAction={onScan}
    />
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

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  // Safe fallback: returns 0 when not inside a bottom tab navigator (e.g. ProfileStack)
  const tabBarHeight = React.useContext(BottomTabBarHeightContext) ?? 0;
  const { theme } = useTheme();

  const { isOffline } = useOfflineGuard();

  const {
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
    displayItems,
    isLoading,
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
  } = useHistoryData();

  // Announce the error transition for screen readers (cross-platform — the
  // EmptyState container has no live region, so announceForAccessibility carries
  // both VoiceOver and TalkBack with no double-announce). Skip the mount render
  // so a screen that opens already-errored does not announce on top of focus.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (isError) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your history. Try again.",
      );
    }
  }, [isError]);

  // Tell screen-reader users the history is loading. Delayed
  // 500ms to match the modal-safe pattern (docs/solutions/conventions/on-open-
  // announce-must-delay-past-modal-present-focus-shift-2026-06-25.md) —
  // harmless on this non-modal route, kept for consistency with the other
  // skeleton screens fixed alongside this one
  // (todos/archive/P2-2026-09-23-skeleton-loaders-screen-reader-busy-state.md).
  // Covers the FlatList's ListEmptyComponent skeleton.
  //
  // Gated on !isError too: without this guard, a fast error could announce
  // "Couldn't load..." and then, once this timer elapses, "Loading" — a
  // stale announcement after the failure was already reported.
  useDelayedLoadingAnnouncement(isLoading && !isError);

  // Offline transitions are announced by the always-mounted global OfflineBanner
  // (client/components/OfflineBanner.tsx) — iOS via announceForAccessibility,
  // Android via its assertive live-region alert. A per-screen announce here would
  // double-announce, so none is added.

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

  // Error gate — only fires when there is no cached data to show.
  if (isError) {
    return (
      <View
        style={[
          styles.errorContainer,
          {
            backgroundColor: theme.backgroundRoot,
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
      >
        <EmptyState
          variant="temporary"
          icon="alert-circle"
          title="Couldn't load your history"
          description="Something went wrong loading your scan history. Check your connection and try again."
          actionLabel="Try Again"
          onAction={() => {
            void handleRefresh();
          }}
        />
      </View>
    );
  }

  return (
    <>
      {isOffline && (
        <ThemedText
          type="small"
          style={{
            color: theme.textSecondary,
            textAlign: "center",
            paddingVertical: Spacing.sm,
          }}
        >
          You&apos;re offline. Deletions will sync when you reconnect.
        </ThemedText>
      )}
      <FlatList
        {...FLATLIST_DEFAULTS}
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
        extraData={extraData}
        onScrollBeginDrag={handleScrollBeginDrag}
        ListEmptyComponent={
          isLoading ? (
            // SkeletonList hides its own subtree on both platforms — no
            // wrapper needed (see client/components/SkeletonLoader.tsx's
            // SkeletonLoadingRegion).
            <SkeletonList count={5} />
          ) : (
            <HistoryEmptyState onScan={handleScanPress} />
          )
        }
        ListFooterComponent={isFetchingNextPage ? <LoadingFooter /> : null}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={theme.link}
          />
        }
        ItemSeparatorComponent={ItemSeparator}
        getItemLayout={getItemLayout}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        accessibilityLabel="Full scan history list"
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
  itemCard: {
    padding: Spacing.lg,
  },
  itemContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  itemMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  expandButton: {
    alignSelf: "center",
    minWidth: 28,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
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
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
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
