import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  Pressable,
  ScrollView,
  RefreshControl,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { CalorieRing } from "@/components/CalorieRing";
import { EmptyState } from "@/components/EmptyState";
import {
  SkeletonBox,
  SkeletonLoadingRegion,
  SkeletonProvider,
} from "@/components/SkeletonLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { MealSuggestionsModal } from "@/components/MealSuggestionsModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { formatPlanAddSuccess } from "@/components/coach/coach-chat-utils";
import { useAccessibility } from "@/hooks/useAccessibility";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  dateStripSnapBackSpringConfig,
  dateStripSwipeThreshold,
} from "@/constants/animations";
import {
  MEAL_LABELS,
  type MealType,
  computeItemMacros,
  computeMealSectionSummary,
  getAutoExpandedMealType,
} from "./meal-plan-utils";
import {
  useMealPlanItems,
  useRemoveMealPlanItem,
  useReorderMealPlanItems,
  invalidateMealPlanItems,
  useAddMealPlanItem,
  useConfirmMealPlanItem,
} from "@/hooks/useMealPlan";
import { useDailyBudget } from "@/hooks/useDailyBudget";
import { useMealPlanSheets } from "@/hooks/useMealPlanSheets";
import { DateStripItem } from "@/components/meal-plan/DateStrip";
import { MealSlotSection } from "@/components/meal-plan/MealSlotSection";
import { useSheetHostProps } from "@/hooks/useSheetHostProps";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import { useExpiringPantryItems } from "@/hooks/usePantry";
import { QUICK_ADD_SNAP_POINTS } from "@/components/meal-plan/QuickAddSheet";
import { ADD_ITEM_MENU_SNAP_POINTS } from "@/components/meal-plan/AddItemMenuSheet";
import { IMPORT_RECIPE_SNAP_POINTS } from "@/components/meal-plan/ImportRecipeSheet";
import { SIMPLE_ENTRY_SNAP_POINTS } from "@/components/meal-plan/SimpleEntrySheet";
import type { MealPlanHomeScreenNavigationProp } from "@/types/navigation";
import type { DailySummaryResponse } from "@/types/api";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
// Device-LOCAL basis: `planned_date` must be the day the user tapped on the
// date strip, which is derived from local component getters below
// (`setHours(0,0,0,0)`, `getDate()`). `toDateString` (UTC) would key a
// UTC-positive device one calendar day earlier than its own chip label.
import { toLocalDateString } from "@shared/lib/date";
import { useDelayedLoadingAnnouncement } from "@/hooks/useDelayedLoadingAnnouncement";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

interface TopAction {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  badgeCount?: number;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getDayLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// ── CalorieRing replaces DailyTotals + Empty State ──────────────────

// ── Main Screen ──────────────────────────────────────────────────────

// Free: 7 days forward, Premium: 90 days forward
const FREE_MAX_DAYS_FORWARD = 7;
const PREMIUM_MAX_DAYS_FORWARD = 90;

export default function MealPlanHomeScreen() {
  const navigation = useNavigation<MealPlanHomeScreenNavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { features, isPremium } = usePremiumContext();
  const { reducedMotion } = useAccessibility();

  const dateStripTranslateX = useSharedValue(0);

  // Shared host prop bundle for all 4 sheets below (backdrop, themed
  // background, hidden handle, and the accessible={false} iOS a11y fix —
  // see useSheetHostProps' own JSDoc). BottomSheetModal's own background
  // defaults to white regardless of theme, so it must be themed explicitly.
  const sheetHostProps = useSheetHostProps({
    backgroundColor: theme.backgroundDefault,
    backdropOpacity: 0.35,
    backdropPressBehavior: "close",
  });

  const [today, setToday] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Update 'today' when screen comes into focus (handles midnight crossing)
  useFocusEffect(
    useCallback(() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (d.getTime() !== today.getTime()) {
        setToday(d);
      }
    }, [today]),
  );

  const [selectedDate, setSelectedDate] = useState(today);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [suggestModalVisible, setSuggestModalVisible] = useState(false);
  const [suggestMealType, setSuggestMealType] = useState<MealType>("breakfast");
  const [expandedSections, setExpandedSections] = useState<Set<MealType>>(
    () => new Set([getAutoExpandedMealType()]),
  );
  const selectedDateStr = toLocalDateString(selectedDate);

  // BottomSheetModal must be declared directly in this screen component —
  // declaring it inside an imported child component silently breaks
  // .present() (no error, no onChange/onAnimate, no visual change). See
  // docs/solutions for the root-cause writeup. Each child below only owns
  // its content; this screen owns the modal JSX, and useMealPlanSheets owns
  // the sheet state, refs and present/dismiss effect it wires onto them.
  // The Android back handler (useSheetBackHandler) is also called inside
  // that hook; onSheetChange/onSheetAnimate below are its
  // outputs, wired onto every <BottomSheetModal>.
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
  } = useMealPlanSheets({ navigation, selectedDateStr });

  // Destructure rather than depend on the mutation objects themselves —
  // useMutation returns a new object identity every render, which would
  // make every useCallback below that depends on it re-create every render
  // (and, since those callbacks feed the memoized MealSlotSection/
  // MealSlotItem rows, defeat their React.memo). See CoachChat.tsx for the
  // same pattern.
  const { mutateAsync: addMealPlanItem } = useAddMealPlanItem();
  const { mutate: confirmItem } = useConfirmMealPlanItem();
  const { data: expiringItems } = useExpiringPantryItems(
    features.pantryTracking,
  );

  // Fetch daily summary for confirmed meal plan item IDs
  const { data: dailySummaryData } = useQuery<DailySummaryResponse>({
    queryKey: ["/api/daily-summary", selectedDateStr],
    queryFn: async () => {
      // apiRequest throws on non-2xx (throwIfResNotOk), so no manual !res.ok guard.
      const res = await apiRequest(
        "GET",
        `/api/daily-summary?date=${selectedDateStr}`,
        undefined,
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return res.json();
    },
  });

  const confirmedIds = useMemo(
    () => new Set(dailySummaryData?.confirmedMealPlanItemIds ?? []),
    [dailySummaryData?.confirmedMealPlanItemIds],
  );

  const maxDaysForward = isPremium
    ? PREMIUM_MAX_DAYS_FORWARD
    : FREE_MAX_DAYS_FORWARD;

  // Generate 7-day date range centered on selected week
  const weekDates = useMemo(() => {
    // Start from the selected date's week start (Sunday)
    const weekStart = new Date(selectedDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [selectedDate]);

  const startDate = toLocalDateString(weekDates[0]);
  const endDate = toLocalDateString(weekDates[6]);

  const {
    data: mealPlanItems,
    isLoading,
    isRefetching,
    isLoadingError,
    refetch: refetchMealPlanItems,
  } = useMealPlanItems(startDate, endDate);

  const { mutate: removeItem } = useRemoveMealPlanItem();
  const { mutate: reorderItems } = useReorderMealPlanItems();

  // Group items by date and meal type
  const dayItems = useMemo(() => {
    if (!mealPlanItems) return {};
    const grouped: Record<string, MealPlanItemWithRelations[]> = {};
    for (const item of mealPlanItems) {
      const key = item.plannedDate;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }
    return grouped;
  }, [mealPlanItems]);

  const selectedDayItems = useMemo(
    () => dayItems[selectedDateStr] || [],
    [dayItems, selectedDateStr],
  );

  const itemsByMealType = useMemo(() => {
    const grouped: Record<string, MealPlanItemWithRelations[]> = {};
    for (const mealType of MEAL_TYPES) {
      grouped[mealType] = selectedDayItems.filter(
        (i) => i.mealType === mealType,
      );
    }
    return grouped;
  }, [selectedDayItems]);

  const sectionSummaries = useMemo(() => {
    const result: Record<string, { itemCount: number; totalCalories: number }> =
      {};
    for (const mealType of MEAL_TYPES) {
      result[mealType] = computeMealSectionSummary(
        itemsByMealType[mealType] || [],
      );
    }
    return result;
  }, [itemsByMealType]);

  // Calorie ring data
  const {
    data: budgetData,
    isError: budgetError,
    refetch: refetchBudget,
  } = useDailyBudget(selectedDateStr);
  const calorieGoal = budgetData?.calorieGoal ?? 2000;

  // Suppress the 2000 default against a failed budget fetch, so we don't show a
  // confident-wrong goal. This is the same condition that renders the error
  // EmptyState below (not `budgetError` alone) — with stale cached data we keep
  // showing the ring, so the announce must track the no-data error only.
  const budgetErrorNoData = budgetError && !budgetData;

  // Announce each error EmptyState for screen readers — neither has a live
  // region, so a cross-platform announce carries both VoiceOver and TalkBack
  // with no double-announce. Both are EDGE-triggered on the error itself
  // (announce on the rise, re-arm only when the error clears), never a
  // re-test of state on every deps change: TanStack resets a data-less query
  // to pending/error:null on refetch, so a state re-test re-announced on
  // unrelated transitions (e.g. the budget copy on every items Try Again).
  // The refs start at their mount value, so a screen that opens already
  // errored does not announce on top of initial focus.
  //
  // Budget: its EmptyState is hidden while the full-screen items skeleton is
  // up (`isLoading`), so the announce is deferred until it is actually on
  // screen. The skeleton covering it is not "clearing" — only
  // budgetErrorNoData falling re-arms it. Items: rendered in the scroll
  // content on isLoadingError (see below); isLoading and isLoadingError are
  // mutually exclusive, so it needs no skeleton gate.
  //
  // ONE effect for both: they can rise in the same commit (a shared outage,
  // or items failing while a skeleton-deferred budget error waits), and iOS
  // drops the second of two same-commit announcements — so a joint rise is
  // spoken as one combined utterance.
  const budgetErrorAnnouncedRef = useRef(budgetErrorNoData && !isLoading);
  const mealPlanErrorAnnouncedRef = useRef(isLoadingError);
  useEffect(() => {
    if (!budgetErrorNoData) budgetErrorAnnouncedRef.current = false;
    if (!isLoadingError) mealPlanErrorAnnouncedRef.current = false;
    const budgetRose =
      budgetErrorNoData && !isLoading && !budgetErrorAnnouncedRef.current;
    const itemsRose = isLoadingError && !mealPlanErrorAnnouncedRef.current;
    if (budgetRose) budgetErrorAnnouncedRef.current = true;
    if (itemsRose) mealPlanErrorAnnouncedRef.current = true;
    if (budgetRose && itemsRose) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your meal plan or calorie budget. Try again.",
      );
    } else if (budgetRose) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your calorie budget. Try again.",
      );
    } else if (itemsRose) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your meal plan. Try again.",
      );
    }
  }, [budgetErrorNoData, isLoading, isLoadingError]);

  // Tell screen-reader users the screen is loading. Delayed 500ms to match
  // the modal-safe pattern (docs/solutions/conventions/on-open-announce-
  // must-delay-past-modal-present-focus-shift-2026-06-25.md) even though
  // this route isn't a modal — harmless here, and keeps the announce shape
  // identical across every skeleton screen fixed alongside this one.
  useDelayedLoadingAnnouncement(isLoading);

  const dailyTotals = useMemo(() => {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    for (const item of selectedDayItems) {
      const macros = computeItemMacros(item);
      if (macros) {
        calories += macros.calories;
        protein += macros.protein;
        carbs += macros.carbs;
        fat += macros.fat;
      }
    }
    return { calories, protein, carbs, fat };
  }, [selectedDayItems]);

  const handleDatePress = useCallback(
    (date: Date) => {
      haptics.selection();
      setSelectedDate(date);
    },
    [haptics],
  );

  const handlePrevWeek = useCallback(() => {
    haptics.selection();
    setSelectedDate((prev) => addDays(prev, -7));
  }, [haptics]);

  const handleNextWeek = useCallback(() => {
    const nextWeek = addDays(selectedDate, 7);
    const daysForward = Math.round(
      (nextWeek.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysForward > maxDaysForward) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      setShowUpgradeModal(true);
      return;
    }
    haptics.selection();
    setSelectedDate(nextWeek);
  }, [haptics, selectedDate, today, maxDaysForward]);

  const handleItemPress = useCallback(
    (item: MealPlanItemWithRelations) => {
      if (item.recipeId) {
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: item.recipeId,
          recipeType: "mealPlan",
        });
      }
    },
    [navigation],
  );

  const handleRemoveItem = useCallback(
    (id: number) => {
      haptics.selection();
      removeItem(id, {
        onError: () =>
          toast.error("Couldn't remove the item. Please try again."),
      });
    },
    [removeItem, haptics, toast],
  );

  const handleReorder = useCallback(
    (reorderedItems: MealPlanItemWithRelations[]) => {
      const updates = reorderedItems.map((item, idx) => ({
        id: item.id,
        sortOrder: idx,
      }));
      reorderItems(updates, {
        onError: () =>
          toast.error("Couldn't save the new order. Please try again."),
      });
    },
    [reorderItems, toast],
  );

  const handleToggleSection = useCallback(
    (mealType: MealType) => {
      haptics.selection();
      setExpandedSections((prev) => {
        const next = new Set(prev);
        const nowExpanded = !next.has(mealType);
        if (nowExpanded) {
          next.add(mealType);
        } else {
          next.delete(mealType);
        }
        if (Platform.OS === "ios") {
          const label = MEAL_LABELS[mealType];
          AccessibilityInfo.announceForAccessibility(
            `${label} ${nowExpanded ? "expanded" : "collapsed"}`,
          );
        }
        return next;
      });
    },
    [haptics],
  );

  const handleAddItem = useCallback(
    (mealType: MealType) => {
      haptics.selection();
      openSheet("addItemMenu", mealType);
    },
    [haptics, openSheet],
  );

  const handleSuggest = useCallback(
    (mealType: MealType) => {
      if (!features.aiMealSuggestions) {
        haptics.notification(Haptics.NotificationFeedbackType.Warning);
        setShowUpgradeModal(true);
        return;
      }
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setSuggestMealType(mealType);
      setSuggestModalVisible(true);
    },
    [features.aiMealSuggestions, haptics],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: MealSuggestion) => {
      try {
        // One server call: the recipe and its plan item are created in a
        // single transaction, so a failure leaves nothing behind.
        await addMealPlanItem({
          recipe: {
            title: suggestion.title,
            description: suggestion.description,
            difficulty: suggestion.difficulty,
            prepTimeMinutes: suggestion.prepTimeMinutes,
            instructions: suggestion.instructions,
            dietTags: suggestion.dietTags,
            sourceType: "ai_suggestion",
            caloriesPerServing: suggestion.calories,
            proteinPerServing: suggestion.protein,
            carbsPerServing: suggestion.carbs,
            fatPerServing: suggestion.fat,
            ingredients: suggestion.ingredients?.map((ing) => ({
              name: ing.name,
              quantity: ing.quantity,
              unit: ing.unit,
            })),
          },
          plannedDate: selectedDateStr,
          mealType: suggestMealType,
        });

        // The modal closes, so confirm with a toast (fires its own Success).
        toast.success(formatPlanAddSuccess(selectedDateStr, suggestMealType));
        setSuggestModalVisible(false);
      } catch {
        toast.error(
          "Couldn't add the suggestion to your plan. Please try again.",
        );
      }
    },
    [addMealPlanItem, selectedDateStr, suggestMealType, toast],
  );

  const handleConfirmItem = useCallback(
    (id: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      confirmItem(id, {
        onError: () => toast.error("Couldn't log the meal. Please try again."),
      });
    },
    [confirmItem, haptics, toast],
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

  const handleRefresh = useCallback(async () => {
    // invalidateMealPlanItems fires-and-forgets internally (its own callers
    // never await it either); the pull-to-refresh spinner is driven by
    // useMealPlanItems' own `isRefetching`, not by this callback's await, so
    // that's still coordinated. Daily-budget and daily-summary (L6, 2026-09-23
    // audit) were previously never refreshed here at all.
    invalidateMealPlanItems(queryClient);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] }),
    ]);
    haptics.impact();
  }, [queryClient, haptics]);

  // Date strip swipe gesture
  const dateStripPanGesture = usePanGesture({
    activeOffsetX: [-20, 20],
    onUpdate: (e) => {
      if (!reducedMotion) {
        // Clamp visual feedback to +/-30px
        dateStripTranslateX.value = Math.max(-30, Math.min(30, e.translationX));
      }
    },
    onDeactivate: (e) => {
      if (e.translationX < -dateStripSwipeThreshold) {
        scheduleOnRN(handleNextWeek);
      } else if (e.translationX > dateStripSwipeThreshold) {
        scheduleOnRN(handlePrevWeek);
      }
      dateStripTranslateX.value = withSpring(0, dateStripSnapBackSpringConfig);
    },
  });

  const dateStripAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dateStripTranslateX.value }],
  }));

  // Month/year header
  const monthYear = selectedDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Config-driven top action row, replacing 4 near-identical Pressables
  // (mirrors client/components/home/action-config.ts's data-driven pattern).
  // Built in-component (not module-level like HOME_ACTIONS) because these
  // actions close over per-render handlers/data (expiringItems' badge count).
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

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight,
            paddingBottom: tabBarHeight + Spacing.xl,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <SkeletonProvider>
          <SkeletonLoadingRegion
            style={styles.skeletonContainer}
            testID="meal-plan-loading-skeleton"
          >
            <SkeletonBox width="60%" height={24} borderRadius={8} />
            <View style={{ height: Spacing.lg }} />
            <SkeletonBox width="100%" height={56} borderRadius={12} />
            <View style={{ height: Spacing.xl }} />
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={{ marginBottom: Spacing.lg }}>
                <SkeletonBox width="30%" height={16} borderRadius={4} />
                <View style={{ height: Spacing.sm }} />
                <SkeletonBox width="100%" height={48} borderRadius={8} />
              </View>
            ))}
          </SkeletonLoadingRegion>
        </SkeletonProvider>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        testID="meal-plan-home-scroll"
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.sm,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            progressViewOffset={headerHeight}
          />
        }
        showsVerticalScrollIndicator={false}
        // Android TalkBack background focus trap while any of the 4 sheets
        // is open — see docs/solutions/conventions/
        // in-screen-overlay-needs-android-focus-trap-2026-06-22.md. iOS is
        // already trapped separately via accessibilityViewIsModal on each
        // sheet's own content root, so no accessibilityElementsHidden here.
        importantForAccessibility={
          isAnySheetOpen ? "no-hide-descendants" : "auto"
        }
      >
        {/* Top action chips: one scrolling row, so a fourth chip never
            wraps alone onto a second line (visual QA sweep #6). */}
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
              hitSlop={8}
              style={[
                styles.groceryButton,
                { backgroundColor: withOpacity(theme.link, 0.1) },
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
            >
              <Feather name={action.icon} size={16} color={theme.link} />
              <ThemedText
                style={[styles.groceryButtonText, { color: theme.link }]}
              >
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

        {/* Month/Year Header with arrows */}
        <View style={styles.monthHeader}>
          <Pressable
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            onPress={handlePrevWeek}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <Feather name="chevron-left" size={20} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.monthTitle}>{monthYear}</ThemedText>
          <Pressable
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            onPress={handleNextWeek}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <Feather name="chevron-right" size={20} color={theme.text} />
          </Pressable>
        </View>

        {/* Date Strip — swipe left/right to change week */}
        <GestureDetector gesture={dateStripPanGesture}>
          <Animated.View style={[styles.dateStrip, dateStripAnimatedStyle]}>
            {weekDates.map((date) => {
              const dateStr = toLocalDateString(date);
              return (
                <DateStripItem
                  key={dateStr}
                  date={date}
                  isSelected={dateStr === selectedDateStr}
                  hasItems={!!dayItems[dateStr]?.length}
                  onPress={handleDatePress}
                />
              );
            })}
          </Animated.View>
        </GestureDetector>

        {/* Day Label */}
        <ThemedText style={styles.dayLabel}>
          {getDayLabel(selectedDate)}
        </ThemedText>

        {/* Calorie Ring — suppress against the 2000 default when the budget
            fetch failed, so the user isn't shown a confident-wrong goal. */}
        {budgetErrorNoData ? (
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Couldn't load your calorie budget"
            description="We couldn't load your goal for this day. Pull down to refresh or tap below to try again."
            actionLabel="Try Again"
            onAction={() => {
              void refetchBudget();
            }}
          />
        ) : (
          <CalorieRing
            consumed={dailyTotals.calories}
            goal={calorieGoal}
            protein={dailyTotals.protein}
            carbs={dailyTotals.carbs}
            fat={dailyTotals.fat}
          />
        )}

        {/* A failed items fetch with no cached data (isLoadingError) renders
            HERE, where the list would go — distinct from `isRefetching`
            (pull-to-refresh keeps the loaded week) and from isRefetchError
            (a background failure with cached data, which keeps showing the
            stale week). Without this branch a failed initial fetch looked
            like a legitimately empty week (2026-09-23 audit, M18). Rendered
            in-scroll, not as an early return, so the week navigation, top
            actions and pull-to-refresh — none of which depend on this query
            — stay usable. */}
        {isLoadingError ? (
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
        ) : selectedDayItems.length === 0 ? (
          <EmptyState
            variant="firstTime"
            icon="calendar"
            title="No meals planned yet"
            description="Plan your week's meals to hit your nutrition goals and auto-generate your grocery list."
            actionLabel="Browse Recipes"
            onAction={handleBrowseRecipes}
          />
        ) : (
          MEAL_TYPES.map((mealType) => {
            const sectionItems = itemsByMealType[mealType] || [];
            return (
              <MealSlotSection
                key={mealType}
                mealType={mealType}
                items={sectionItems}
                confirmedIds={confirmedIds}
                onItemPress={handleItemPress}
                onRemoveItem={handleRemoveItem}
                onAddItem={handleAddItem}
                onSuggest={handleSuggest}
                onConfirmItem={handleConfirmItem}
                onReorder={handleReorder}
                canSuggest={features.aiMealSuggestions}
                canConfirm={features.mealConfirmation}
                isExpanded={expandedSections.has(mealType)}
                onToggle={handleToggleSection}
                sectionSummary={sectionSummaries[mealType]}
              />
            );
          })
        )}

        {/* Spacer for FAB clearance */}
      </ScrollView>

      {/* Modals */}
      <MealSuggestionsModal
        visible={suggestModalVisible}
        date={selectedDateStr}
        mealType={suggestMealType}
        onClose={() => setSuggestModalVisible(false)}
        onSelectSuggestion={handleSelectSuggestion}
      />
      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
      {/* NOTE: `accessibilityViewIsModal` was previously set on each sheet
          below too, but @gorhom/bottom-sheet's BottomSheet has no
          rest-spread, so it was silently dropped — a no-op / false
          focus-trap assurance (same dead prop ConfirmationModal.tsx's own
          fix removed). The real fix lives on each sheet's own inner content
          View, not here: AddItemMenuSheetContent, ImportRecipeSheetContent
          (shared — already had it), QuickAddSheetContent, and
          SimpleEntrySheetContent all set accessibilityViewIsModal on their
          own root View. See docs/solutions/conventions/
          a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md.
          The other focus-trap todo
          (P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md)
          is scoped to ConfirmationModal.tsx and its useConfirmationModal()
          callers only, not this screen. */}
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
  skeletonContainer: {
    padding: Spacing.lg,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  monthTitle: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  dateStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    // Same gutter as the month header above and the chips (sweep #6).
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  dayLabel: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
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
    // color set dynamically with theme.buttonText (white on colored badges)
  },
  groceryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  groceryButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
});
