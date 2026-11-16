import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { EmptyState } from "@/components/EmptyState";
import { PressableScale } from "@/components/PressableScale";
import {
  SkeletonBox,
  SkeletonLoadingRegion,
  SkeletonProvider,
} from "@/components/SkeletonLoader";
import { ThemedText } from "@/components/ThemedText";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ADD_ITEM_MENU_SNAP_POINTS } from "@/components/meal-plan/AddItemMenuSheet";
import { IMPORT_RECIPE_SNAP_POINTS } from "@/components/meal-plan/ImportRecipeSheet";
import { QUICK_ADD_SNAP_POINTS } from "@/components/meal-plan/QuickAddSheet";
import { SIMPLE_ENTRY_SNAP_POINTS } from "@/components/meal-plan/SimpleEntrySheet";
import { WeekGrid } from "@/components/meal-plan/WeekGrid";
import type { MealType } from "@/components/meal-plan/meal-plan-utils";
import {
  SLOTS_PER_WEEK,
  addDays,
  buildWeekGrid,
  countPlannedSlots,
  getWeekDates,
  isBeyondForwardLimit,
} from "@/components/meal-plan/week-grid-utils";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import { usePremiumContext } from "@/context/PremiumContext";
import { useDelayedLoadingAnnouncement } from "@/hooks/useDelayedLoadingAnnouncement";
import { useHaptics } from "@/hooks/useHaptics";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { invalidateMealPlanItems, useMealPlanItems } from "@/hooks/useMealPlan";
import { useMealPlanSheets } from "@/hooks/useMealPlanSheets";
import { useExpiringPantryItems } from "@/hooks/usePantry";
import { usePlanCheck } from "@/hooks/usePlanCheck";
import { useSheetHostProps } from "@/hooks/useSheetHostProps";
import { useTheme } from "@/hooks/useTheme";
import type { MealPlanHomeScreenNavigationProp } from "@/types/navigation";
// Device-LOCAL basis: `planned_date` is the day of the cell the user tapped.
import { toLocalDateString } from "@shared/lib/date";

interface TopAction {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  badgeCount?: number;
}

// Free: 7 days forward, Premium: 90 days forward
const FREE_MAX_DAYS_FORWARD = 7;
const PREMIUM_MAX_DAYS_FORWARD = 90;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The Plan tab's home: the week as a grid, days across and meals down. An
 * empty cell adds a meal to that slot; a filled cell or a day header opens
 * that day (MealPlanDayScreen), which is where the calorie ring, confirm,
 * reorder and remove live.
 */
export default function MealPlanHomeScreen() {
  const navigation = useNavigation<MealPlanHomeScreenNavigationProp>();
  const contentInset = useHeaderContentInset(Spacing.sm);
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const queryClient = useQueryClient();
  const { features, isPremium } = usePremiumContext();
  const { planUnknown, recheckPlan } = usePlanCheck();

  const sheetHostProps = useSheetHostProps({
    backgroundColor: theme.backgroundDefault,
    backdropOpacity: 0.35,
    backdropPressBehavior: "close",
  });

  const [today, setToday] = useState(startOfToday);

  // Update 'today' when the screen comes into focus (handles midnight crossing)
  useFocusEffect(
    useCallback(() => {
      const d = startOfToday();
      if (d.getTime() !== today.getTime()) {
        setToday(d);
      }
    }, [today]),
  );

  // Any day in the visible week.
  const [weekAnchor, setWeekAnchor] = useState(today);
  // The day of the cell whose "+" was tapped last; the four sheets plan onto it.
  const [sheetDateStr, setSheetDateStr] = useState(() =>
    toLocalDateString(today),
  );
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // BottomSheetModal must be declared directly in this screen component —
  // declaring it inside an imported child silently breaks .present(). The
  // same four sheets are declared in MealPlanDayScreen for the same reason;
  // useMealPlanSheets owns the state, refs and the Android back handler.
  const {
    addItemMenuSheetRef,
    importRecipeSheetRef,
    quickAddSheetRef,
    simpleEntrySheetRef,
    isAnySheetOpen,
    openSheet,
    onSheetChange,
    onSheetAnimate,
    handleAddItemMenuDismiss,
    handleImportRecipeDismiss,
    handleQuickAddDismiss,
    handleSimpleEntryDismiss,
    handleQuickAddSheetChange,
    handleSimpleEntrySheetChange,
    addItemMenuSheetChildren,
    importRecipeSheetChildren,
    quickAddSheetChildren,
    simpleEntrySheetChildren,
  } = useMealPlanSheets({ navigation, selectedDateStr: sheetDateStr });

  const { data: expiringItems } = useExpiringPantryItems(
    features.pantryTracking,
  );

  const weekDates = useMemo(() => getWeekDates(weekAnchor), [weekAnchor]);
  const startDate = toLocalDateString(weekDates[0]);
  const endDate = toLocalDateString(weekDates[6]);

  const {
    data: mealPlanItems,
    isLoading,
    isRefetching,
    isLoadingError,
    refetch: refetchMealPlanItems,
  } = useMealPlanItems(startDate, endDate);

  const days = useMemo(
    () => buildWeekGrid(mealPlanItems, weekDates, today),
    [mealPlanItems, weekDates, today],
  );
  const plannedSlots = countPlannedSlots(days);

  // Announce the load error for screen readers: the EmptyState has no live
  // region, so one cross-platform announce carries VoiceOver and TalkBack.
  // Edge-triggered (announce on the rise, re-arm when it clears) and silent
  // when the screen opens already errored — same rule as MealPlanDayScreen.
  const errorAnnouncedRef = useRef(isLoadingError);
  useEffect(() => {
    if (!isLoadingError) {
      errorAnnouncedRef.current = false;
      return;
    }
    if (errorAnnouncedRef.current) return;
    errorAnnouncedRef.current = true;
    AccessibilityInfo.announceForAccessibility(
      "Couldn't load your meal plan. Try again.",
    );
  }, [isLoadingError]);

  useDelayedLoadingAnnouncement(isLoading);

  const maxDaysForward = isPremium
    ? PREMIUM_MAX_DAYS_FORWARD
    : FREE_MAX_DAYS_FORWARD;

  const handlePrevWeek = useCallback(() => {
    haptics.selection();
    setWeekAnchor((prev) => addDays(prev, -7));
  }, [haptics]);

  const handleNextWeek = useCallback(() => {
    const nextAnchor = addDays(weekAnchor, 7);
    if (isBeyondForwardLimit(nextAnchor, today, maxDaysForward)) {
      // Owner ruling 2026-11-02: an unknown plan is neutral. While the
      // subscription is still loading the limit above is the free one, so
      // recheck instead of upselling someone who may already be paying.
      if (planUnknown) {
        recheckPlan();
        return;
      }
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      setShowUpgradeModal(true);
      return;
    }
    haptics.selection();
    setWeekAnchor(nextAnchor);
  }, [haptics, weekAnchor, today, maxDaysForward, planUnknown, recheckPlan]);

  const handleAddPress = useCallback(
    (dateStr: string, mealType: MealType) => {
      haptics.selection();
      // Both updates land in one render, so the sheet's contents are built
      // with this cell's day, never the one a previous sheet was opened for.
      setSheetDateStr(dateStr);
      openSheet("addItemMenu", mealType);
    },
    [haptics, openSheet],
  );

  const handleDayPress = useCallback(
    (dateStr: string) => {
      haptics.selection();
      navigation.navigate("MealPlanDay", { date: dateStr });
    },
    [haptics, navigation],
  );

  const handleBrowseRecipes = useCallback(() => {
    haptics.selection();
    navigation.navigate("RecipeBrowser", {});
  }, [haptics, navigation]);

  const handleGroceryLists = useCallback(() => {
    haptics.selection();
    navigation.navigate("GroceryLists");
  }, [haptics, navigation]);

  const handlePantry = useCallback(() => {
    haptics.selection();
    navigation.navigate("Pantry");
  }, [haptics, navigation]);

  const handleCookbooks = useCallback(() => {
    haptics.selection();
    navigation.navigate("CookbookList");
  }, [haptics, navigation]);

  const handleRefresh = useCallback(() => {
    // Fire-and-forget: the spinner is driven by the query's own
    // `isRefetching`, not by this callback.
    invalidateMealPlanItems(queryClient);
    haptics.impact();
  }, [queryClient, haptics]);

  const monthYear = weekDates[0].toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const topActions: TopAction[] = useMemo(
    () => [
      {
        id: "recipes",
        icon: "book-open",
        label: "Recipes",
        accessibilityLabel: "Browse Recipes",
        onPress: handleBrowseRecipes,
      },
      {
        id: "pantry",
        icon: "package",
        label: "Pantry",
        accessibilityLabel: `Pantry${expiringItems?.length ? `, ${expiringItems.length} expiring` : ""}`,
        onPress: handlePantry,
        badgeCount: expiringItems?.length,
      },
      {
        id: "grocery",
        icon: "shopping-cart",
        label: "Grocery Lists",
        accessibilityLabel: "Grocery Lists",
        onPress: handleGroceryLists,
      },
      {
        id: "cookbooks",
        icon: "book",
        label: "Cookbooks",
        accessibilityLabel: "Cookbooks",
        onPress: handleCookbooks,
      },
    ],
    [
      handleBrowseRecipes,
      handlePantry,
      handleGroceryLists,
      handleCookbooks,
      expiringItems,
    ],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        testID="meal-plan-home-scroll"
        contentContainerStyle={{
          paddingTop: contentInset,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            progressViewOffset={contentInset}
          />
        }
        showsVerticalScrollIndicator={false}
        // Android TalkBack background focus trap while any of the 4 sheets
        // is open. iOS is trapped by accessibilityViewIsModal on each sheet's
        // own content root.
        importantForAccessibility={
          isAnySheetOpen ? "no-hide-descendants" : "auto"
        }
      >
        {/* Top action chips: one scrolling row, so a fourth chip never wraps
            alone onto a second line. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topActionsScroll}
          contentContainerStyle={styles.topActions}
        >
          {topActions.map((action) => (
            <PressableScale
              scaleTo={0.95}
              key={action.id}
              onPress={action.onPress}
              style={[
                styles.chip,
                { backgroundColor: withOpacity(theme.link, 0.1) },
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
            >
              <Feather name={action.icon} size={16} color={theme.link} />
              <ThemedText style={[styles.chipText, { color: theme.link }]}>
                {action.label}
              </ThemedText>
              {!!action.badgeCount && (
                <View
                  style={[
                    styles.expiringBadge,
                    { backgroundColor: theme.calorieAccent },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.expiringBadgeText,
                      { color: theme.buttonText },
                    ]}
                  >
                    {action.badgeCount}
                  </ThemedText>
                </View>
              )}
            </PressableScale>
          ))}
        </ScrollView>

        {/* Week header: arrows either side of the month and the slot count */}
        <View style={styles.weekHeader}>
          <Pressable
            style={({ pressed }) => [
              styles.weekArrow,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handlePrevWeek}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <Feather name="chevron-left" size={20} color={theme.text} />
          </Pressable>
          <View style={styles.weekTitle}>
            <ThemedText style={styles.monthTitle}>{monthYear}</ThemedText>
            {!isLoading && !isLoadingError && (
              <ThemedText
                style={[styles.slotCount, { color: theme.textSecondary }]}
              >
                {`${plannedSlots} of ${SLOTS_PER_WEEK} planned`}
              </ThemedText>
            )}
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.weekArrow,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handleNextWeek}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <Feather name="chevron-right" size={20} color={theme.text} />
          </Pressable>
        </View>

        {isLoading ? (
          <SkeletonProvider>
            <SkeletonLoadingRegion
              style={styles.skeleton}
              testID="meal-plan-loading-skeleton"
            >
              {[0, 1, 2, 3, 4].map((row) => (
                <View key={row} style={styles.skeletonRow}>
                  {[0, 1, 2].map((col) => (
                    <View key={col} style={styles.skeletonCell}>
                      <SkeletonBox
                        width="100%"
                        height={row === 0 ? 52 : 96}
                        borderRadius={BorderRadius.sm}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </SkeletonLoadingRegion>
          </SkeletonProvider>
        ) : isLoadingError ? (
          // A failed first load renders HERE, where the grid would go, so
          // the chips, the week arrows and pull-to-refresh — none of which
          // depend on this query — stay usable. A failed background refetch
          // keeps the stale grid instead.
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Couldn't load your meal plan"
            description="Something went wrong loading this week's meals. Pull down to refresh or tap below to try again."
            actionLabel="Try Again"
            onAction={() => {
              void refetchMealPlanItems();
            }}
          />
        ) : (
          <WeekGrid
            days={days}
            onAddPress={handleAddPress}
            onDayPress={handleDayPress}
          />
        )}
      </ScrollView>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
      <BottomSheetModal
        ref={addItemMenuSheetRef}
        snapPoints={ADD_ITEM_MENU_SNAP_POINTS}
        enableDynamicSizing={false}
        onDismiss={handleAddItemMenuDismiss}
        onChange={onSheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {addItemMenuSheetChildren}
      </BottomSheetModal>
      <BottomSheetModal
        ref={importRecipeSheetRef}
        snapPoints={IMPORT_RECIPE_SNAP_POINTS}
        enableDynamicSizing={false}
        onDismiss={handleImportRecipeDismiss}
        onChange={onSheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {importRecipeSheetChildren}
      </BottomSheetModal>
      <BottomSheetModal
        ref={quickAddSheetRef}
        snapPoints={QUICK_ADD_SNAP_POINTS}
        enableDynamicSizing={false}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        onDismiss={handleQuickAddDismiss}
        onChange={handleQuickAddSheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {quickAddSheetChildren}
      </BottomSheetModal>
      <BottomSheetModal
        ref={simpleEntrySheetRef}
        snapPoints={SIMPLE_ENTRY_SNAP_POINTS}
        enableDynamicSizing={false}
        keyboardBehavior="fillParent"
        keyboardBlurBehavior="restore"
        onDismiss={handleSimpleEntryDismiss}
        onChange={handleSimpleEntrySheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {simpleEntrySheetChildren}
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topActionsScroll: {
    flexGrow: 0,
    marginBottom: Spacing.sm,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  chipText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  expiringBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  expiringBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.bold,
  },
  weekHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.md,
  },
  weekArrow: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  weekTitle: {
    alignItems: "center",
    gap: 2,
  },
  monthTitle: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  slotCount: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  skeleton: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  skeletonCell: {
    flex: 1,
  },
});
