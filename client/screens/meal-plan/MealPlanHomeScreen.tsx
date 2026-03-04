import React, { useCallback, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  Pressable,
  ScrollView,
  RefreshControl,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SwipeableRow } from "@/components/SwipeableRow";
import { DraggableList } from "@/components/DraggableList";
import { EmptyState as EmptyStateComponent } from "@/components/EmptyState";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { MealSuggestionsModal } from "@/components/MealSuggestionsModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
  FAB_CLEARANCE,
} from "@/constants/theme";
import {
  dateStripSwipeThreshold,
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";
import {
  computeItemMacros,
  computeMealSectionSummary,
  formatMacroLine,
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
import { apiRequest } from "@/lib/query-client";
import { useCreateMealPlanRecipe } from "@/hooks/useMealPlanRecipes";
import { useExpiringPantryItems } from "@/hooks/usePantry";
import { QuickAddSheet } from "@/components/meal-plan/QuickAddSheet";
import type { MealPlanHomeScreenNavigationProp } from "@/types/navigation";
import type { DailySummaryResponse } from "@/types/api";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
import { formatDateISO as formatDate } from "@/lib/format";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealType = (typeof MEAL_TYPES)[number];
const MEAL_ICONS: Record<MealType, string> = {
  breakfast: "sunrise",
  lunch: "sun",
  dinner: "moon",
  snack: "coffee",
};
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

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

// ── Date Strip Item ──────────────────────────────────────────────────

const DateStripItem = React.memo(function DateStripItem({
  date,
  isSelected,
  hasItems,
  onPress,
}: {
  date: Date;
  isSelected: boolean;
  hasItems: boolean;
  onPress: (date: Date) => void;
}) {
  const { theme } = useTheme();
  const dayName = date
    .toLocaleDateString("en-US", { weekday: "short" })
    .charAt(0);
  const dayNum = date.getDate();

  return (
    <Pressable
      onPress={() => onPress(date)}
      style={[
        styles.dateStripItem,
        {
          backgroundColor: isSelected
            ? theme.link
            : withOpacity(theme.text, 0.05),
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${isSelected ? ", selected" : ""}`}
      accessibilityState={{ selected: isSelected }}
    >
      <ThemedText
        style={[
          styles.dateStripDayName,
          { color: isSelected ? theme.buttonText : theme.textSecondary },
        ]}
      >
        {dayName}
      </ThemedText>
      <ThemedText
        style={[
          styles.dateStripDayNum,
          { color: isSelected ? theme.buttonText : theme.text },
        ]}
      >
        {dayNum}
      </ThemedText>
      {hasItems && !isSelected && (
        <View style={[styles.dateStripDot, { backgroundColor: theme.link }]} />
      )}
    </Pressable>
  );
});

// ── Meal Slot Card ───────────────────────────────────────────────────

const MealSlotItem = React.memo(function MealSlotItem({
  item,
  isConfirmed,
  onPress,
  onRemove,
  onConfirm,
  canConfirm,
}: {
  item: MealPlanItemWithRelations;
  isConfirmed: boolean;
  onPress: (item: MealPlanItemWithRelations) => void;
  onRemove: (id: number) => void;
  onConfirm: (id: number) => void;
  canConfirm: boolean;
}) {
  const { theme } = useTheme();
  const isOrphaned =
    !item.recipe && !item.scannedItem && !item.recipeId && !item.scannedItemId;
  const name = isOrphaned
    ? "Item removed"
    : item.recipe?.title || item.scannedItem?.productName || "Unknown item";
  const macros = isOrphaned ? null : computeItemMacros(item);
  const macroLine = macros ? formatMacroLine(macros) : null;

  const accessLabel = macros
    ? `${name}, ${macros.calories} calories, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fat}g fat${isConfirmed ? ", confirmed" : ""}`
    : `${name}${isConfirmed ? ", confirmed" : ""}`;

  return (
    <Pressable
      onPress={() => !isOrphaned && onPress(item)}
      style={[
        styles.mealSlotItem,
        {
          backgroundColor: isOrphaned
            ? withOpacity(theme.text, 0.02)
            : isConfirmed
              ? withOpacity(theme.success, 0.08)
              : withOpacity(theme.text, 0.04),
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessLabel}
    >
      {canConfirm && (
        <Pressable
          onPress={() => !isConfirmed && onConfirm(item.id)}
          hitSlop={8}
          style={{ marginRight: Spacing.sm }}
          accessibilityRole="button"
          accessibilityLabel={
            isConfirmed ? `${name} confirmed` : `Confirm ${name} as eaten`
          }
          disabled={isConfirmed}
        >
          <Feather
            name={isConfirmed ? "check-circle" : "circle"}
            size={20}
            color={isConfirmed ? theme.success : theme.textSecondary}
          />
        </Pressable>
      )}
      <View style={styles.mealSlotContent}>
        <ThemedText
          style={[
            styles.mealSlotName,
            isOrphaned && { color: theme.textSecondary, fontStyle: "italic" },
          ]}
          numberOfLines={1}
        >
          {name}
        </ThemedText>
        {macroLine !== null && (
          <ThemedText
            style={[styles.mealSlotCalories, { color: theme.textSecondary }]}
          >
            {macroLine}
          </ThemedText>
        )}
      </View>
      <Pressable
        onPress={() => onRemove(item.id)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
      >
        <Feather name="x" size={16} color={theme.textSecondary} />
      </Pressable>
    </Pressable>
  );
});

// ── Meal Slot Section ────────────────────────────────────────────────

const MealSlotSection = React.memo(function MealSlotSection({
  mealType,
  items,
  confirmedIds,
  onItemPress,
  onRemoveItem,
  onAddItem,
  onSuggest,
  onConfirmItem,
  onReorder,
  canSuggest,
  canConfirm,
  isExpanded,
  onToggle,
  sectionSummary,
}: {
  mealType: MealType;
  items: MealPlanItemWithRelations[];
  confirmedIds: Set<number>;
  onItemPress: (item: MealPlanItemWithRelations) => void;
  onRemoveItem: (id: number) => void;
  onAddItem: (mealType: MealType) => void;
  onSuggest: (mealType: MealType) => void;
  onConfirmItem: (id: number) => void;
  onReorder?: (items: MealPlanItemWithRelations[]) => void;
  canSuggest: boolean;
  canConfirm: boolean;
  isExpanded: boolean;
  onToggle: (mealType: MealType) => void;
  sectionSummary: { itemCount: number; totalCalories: number };
}) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const iconName = MEAL_ICONS[mealType] || "circle";
  const label = MEAL_LABELS[mealType] || mealType;

  // Animated height for expand/collapse
  const contentHeight = useSharedValue(0);
  const animatedHeight = useSharedValue(isExpanded ? -1 : 0); // -1 = auto
  const isFirstRender = React.useRef(true);

  const onContentLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const measured = e.nativeEvent.layout.height;
      contentHeight.value = measured;
      // On first render, if expanded, set to auto (don't animate)
      if (isFirstRender.current) {
        isFirstRender.current = false;
        if (isExpanded) {
          animatedHeight.value = -1; // auto
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [isExpanded],
  );

  // Respond to expand/collapse changes
  React.useEffect(() => {
    if (isFirstRender.current) return;

    if (reducedMotion) {
      animatedHeight.value = isExpanded ? -1 : 0;
    } else if (isExpanded) {
      animatedHeight.value = withTiming(
        contentHeight.value,
        expandTimingConfig,
        (finished) => {
          if (finished) {
            animatedHeight.value = -1; // switch to auto after animation
          }
        },
      );
    } else {
      // Snap to measured height first (from auto), then animate to 0
      animatedHeight.value = contentHeight.value;
      animatedHeight.value = withTiming(0, collapseTimingConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
  }, [isExpanded, reducedMotion]);

  const animatedContentStyle = useAnimatedStyle(() => {
    if (animatedHeight.value === -1) {
      return { overflow: "visible" as const };
    }
    return {
      height: animatedHeight.value,
      overflow: "hidden" as const,
    };
  });

  const summaryText =
    sectionSummary.itemCount > 0
      ? ` \u00B7 ${sectionSummary.itemCount} item${sectionSummary.itemCount !== 1 ? "s" : ""} \u00B7 ${sectionSummary.totalCalories} cal`
      : "";

  const headerAccessLabel = isExpanded
    ? `${label}, expanded`
    : `${label}${summaryText}, collapsed`;

  return (
    <View style={styles.mealSlotSection}>
      <Pressable
        onPress={() => onToggle(mealType)}
        style={styles.mealSlotHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={headerAccessLabel}
      >
        <Feather
          name={iconName as keyof typeof Feather.glyphMap}
          size={16}
          color={theme.link}
        />
        <ThemedText style={[styles.mealSlotLabel, { flex: 1 }]}>
          {label}
          {!isExpanded && summaryText ? (
            <ThemedText
              style={[styles.collapsedSummary, { color: theme.textSecondary }]}
            >
              {summaryText}
            </ThemedText>
          ) : null}
        </ThemedText>
        {isExpanded && (
          <Pressable
            onPress={() => onSuggest(mealType)}
            hitSlop={8}
            style={[
              styles.suggestChip,
              {
                backgroundColor: canSuggest
                  ? withOpacity(theme.link, 0.1)
                  : withOpacity(theme.text, 0.05),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              canSuggest
                ? `AI suggest ${label.toLowerCase()}`
                : `Upgrade to suggest ${label.toLowerCase()}`
            }
          >
            <Feather
              name={canSuggest ? "zap" : "lock"}
              size={12}
              color={canSuggest ? theme.link : theme.textSecondary}
            />
            <ThemedText
              style={[
                styles.suggestChipText,
                {
                  color: canSuggest ? theme.link : theme.textSecondary,
                },
              ]}
            >
              Suggest
            </ThemedText>
          </Pressable>
        )}
        <Feather
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.textSecondary}
          style={{ marginLeft: Spacing.sm }}
        />
      </Pressable>
      <Animated.View style={animatedContentStyle}>
        <View onLayout={onContentLayout}>
          {items.length > 1 && onReorder ? (
            <DraggableList
              items={items}
              keyExtractor={(item) => item.id}
              renderItem={(item) => (
                <SwipeableRow
                  rightAction={{
                    icon: "trash-2",
                    label: "Remove",
                    backgroundColor: theme.error,
                    onAction: () => onRemoveItem(item.id),
                  }}
                >
                  <MealSlotItem
                    item={item}
                    isConfirmed={confirmedIds.has(item.id)}
                    onPress={onItemPress}
                    onRemove={onRemoveItem}
                    onConfirm={onConfirmItem}
                    canConfirm={canConfirm}
                  />
                </SwipeableRow>
              )}
              onReorder={onReorder}
            />
          ) : (
            items.map((item) => (
              <SwipeableRow
                key={item.id}
                rightAction={{
                  icon: "trash-2",
                  label: "Remove",
                  backgroundColor: theme.error,
                  onAction: () => onRemoveItem(item.id),
                }}
              >
                <MealSlotItem
                  item={item}
                  isConfirmed={confirmedIds.has(item.id)}
                  onPress={onItemPress}
                  onRemove={onRemoveItem}
                  onConfirm={onConfirmItem}
                  canConfirm={canConfirm}
                />
              </SwipeableRow>
            ))
          )}
          <Pressable
            onPress={() => onAddItem(mealType)}
            style={[
              styles.addItemButton,
              { borderColor: withOpacity(theme.text, 0.1) },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${label.toLowerCase()} item`}
          >
            <Feather name="plus" size={16} color={theme.link} />
            <ThemedText style={[styles.addItemText, { color: theme.link }]}>
              Add item
            </ThemedText>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
});

// ── Daily Totals ─────────────────────────────────────────────────────

const DailyTotals = React.memo(function DailyTotals({
  items,
}: {
  items: MealPlanItemWithRelations[];
}) {
  const { theme } = useTheme();

  const totals = useMemo(() => {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;

    for (const item of items) {
      const macros = computeItemMacros(item);
      if (macros) {
        calories += macros.calories;
        protein += macros.protein;
        carbs += macros.carbs;
        fat += macros.fat;
      }
    }

    return { calories, protein, carbs, fat };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <View
      style={[
        styles.dailyTotals,
        { backgroundColor: withOpacity(theme.link, 0.08) },
      ]}
    >
      <ThemedText style={styles.dailyTotalsTitle}>Daily Total</ThemedText>
      <View style={styles.dailyTotalsRow}>
        <View style={styles.dailyTotalItem}>
          <ThemedText
            style={[styles.dailyTotalValue, { color: theme.calorieAccent }]}
          >
            {totals.calories}
          </ThemedText>
          <ThemedText
            style={[styles.dailyTotalLabel, { color: theme.textSecondary }]}
          >
            cal
          </ThemedText>
        </View>
        <View style={styles.dailyTotalItem}>
          <ThemedText
            style={[styles.dailyTotalValue, { color: theme.proteinAccent }]}
          >
            {totals.protein}g
          </ThemedText>
          <ThemedText
            style={[styles.dailyTotalLabel, { color: theme.textSecondary }]}
          >
            protein
          </ThemedText>
        </View>
        <View style={styles.dailyTotalItem}>
          <ThemedText
            style={[styles.dailyTotalValue, { color: theme.carbsAccent }]}
          >
            {totals.carbs}g
          </ThemedText>
          <ThemedText
            style={[styles.dailyTotalLabel, { color: theme.textSecondary }]}
          >
            carbs
          </ThemedText>
        </View>
        <View style={styles.dailyTotalItem}>
          <ThemedText
            style={[styles.dailyTotalValue, { color: theme.fatAccent }]}
          >
            {totals.fat}g
          </ThemedText>
          <ThemedText
            style={[styles.dailyTotalLabel, { color: theme.textSecondary }]}
          >
            fat
          </ThemedText>
        </View>
      </View>
    </View>
  );
});

// ── Empty State ──────────────────────────────────────────────────────

function MealPlanEmptyState() {
  return (
    <EmptyStateComponent
      variant="temporary"
      icon="calendar"
      title="Plan Your Meals"
      description={
        'Tap "+ Add item" on any meal slot to start building your daily plan.'
      }
    />
  );
}

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
  const queryClient = useQueryClient();
  const { features, isPremium } = usePremiumContext();
  const { reducedMotion } = useAccessibility();

  const dateStripTranslateX = useSharedValue(0);

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
  const [quickAddMealType, setQuickAddMealType] = useState<MealType | null>(
    null,
  );

  const selectedDateStr = formatDate(selectedDate);

  const createRecipeMutation = useCreateMealPlanRecipe();
  const addItemMutation = useAddMealPlanItem();
  const confirmMutation = useConfirmMealPlanItem();
  const { data: expiringItems } = useExpiringPantryItems(
    features.pantryTracking,
  );

  // Fetch daily summary for confirmed meal plan item IDs
  const { data: dailySummaryData } = useQuery<DailySummaryResponse>({
    queryKey: ["/api/daily-summary", selectedDateStr],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/daily-summary?date=${selectedDateStr}`,
      );
      if (!res.ok) {
        throw new Error(`${res.status}: ${res.statusText}`);
      }
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

  const startDate = formatDate(weekDates[0]);
  const endDate = formatDate(weekDates[6]);

  const {
    data: mealPlanItems,
    isLoading,
    isRefetching,
  } = useMealPlanItems(startDate, endDate);

  const removeMutation = useRemoveMealPlanItem();
  const reorderMutation = useReorderMealPlanItems();

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
        navigation.navigate("RecipeDetail", { recipeId: item.recipeId });
      }
    },
    [navigation],
  );

  const handleRemoveItem = useCallback(
    (id: number) => {
      haptics.selection();
      removeMutation.mutate(id);
    },
    [removeMutation, haptics],
  );

  const handleReorder = useCallback(
    (reorderedItems: MealPlanItemWithRelations[]) => {
      const updates = reorderedItems.map((item, idx) => ({
        id: item.id,
        sortOrder: idx,
      }));
      reorderMutation.mutate(updates);
    },
    [reorderMutation],
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
      setQuickAddMealType(mealType);
    },
    [haptics],
  );

  const handleQuickAddDismiss = useCallback(() => {
    setQuickAddMealType(null);
  }, []);

  const handleNavigateCreate = useCallback(
    (mt: MealType, date: string) => {
      navigation.navigate("RecipeCreate", {
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation],
  );

  const handleNavigateImport = useCallback(
    (mt: MealType, date: string) => {
      navigation.navigate("RecipeImport", {
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation],
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
        // Create recipe from suggestion
        const recipe = await createRecipeMutation.mutateAsync({
          title: suggestion.title,
          description: suggestion.description,
          difficulty: suggestion.difficulty,
          prepTimeMinutes: suggestion.prepTimeMinutes,
          instructions: suggestion.instructions,
          dietTags: suggestion.dietTags,
          caloriesPerServing: suggestion.calories,
          proteinPerServing: suggestion.protein,
          carbsPerServing: suggestion.carbs,
          fatPerServing: suggestion.fat,
          ingredients: suggestion.ingredients.map((ing) => ({
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
        });

        // Add to meal plan
        await addItemMutation.mutateAsync({
          recipeId: recipe.id,
          plannedDate: selectedDateStr,
          mealType: suggestMealType,
        });

        haptics.notification(Haptics.NotificationFeedbackType.Success);
        setSuggestModalVisible(false);
        invalidateMealPlanItems(queryClient);
      } catch {
        // Mutation errors handled by React Query
      }
    },
    [
      createRecipeMutation,
      addItemMutation,
      selectedDateStr,
      suggestMealType,
      haptics,
      queryClient,
    ],
  );

  const handleConfirmItem = useCallback(
    (id: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      confirmMutation.mutate(id);
    },
    [confirmMutation, haptics],
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

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] });
  }, [queryClient]);

  // Date strip swipe gesture
  const dateStripPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .onUpdate((e) => {
          if (!reducedMotion) {
            // Clamp visual feedback to +/-30px
            dateStripTranslateX.value = Math.max(
              -30,
              Math.min(30, e.translationX),
            );
          }
        })
        .onEnd((e) => {
          if (e.translationX < -dateStripSwipeThreshold) {
            runOnJS(handleNextWeek)();
          } else if (e.translationX > dateStripSwipeThreshold) {
            runOnJS(handlePrevWeek)();
          }
          dateStripTranslateX.value = withSpring(0, {
            damping: 20,
            stiffness: 200,
          });
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dateStripTranslateX is a stable shared value ref
    [reducedMotion, handleNextWeek, handlePrevWeek],
  );

  const dateStripAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dateStripTranslateX.value }],
  }));

  // Month/year header
  const monthYear = selectedDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight,
            paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <View style={styles.skeletonContainer}>
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
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.sm,
          paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            progressViewOffset={headerHeight}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Top Action Buttons */}
        <View style={styles.topActions}>
          <Pressable
            onPress={handleBrowseRecipes}
            hitSlop={8}
            style={[
              styles.groceryButton,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Browse Recipes"
          >
            <Feather name="book-open" size={16} color={theme.link} />
            <ThemedText
              style={[styles.groceryButtonText, { color: theme.link }]}
            >
              Recipes
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={handlePantry}
            hitSlop={8}
            style={[
              styles.groceryButton,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Pantry${expiringItems?.length ? `, ${expiringItems.length} expiring` : ""}`}
          >
            <Feather name="package" size={16} color={theme.link} />
            <ThemedText
              style={[styles.groceryButtonText, { color: theme.link }]}
            >
              Pantry
            </ThemedText>
            {(expiringItems?.length ?? 0) > 0 && (
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
                  {expiringItems!.length}
                </ThemedText>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={handleGroceryLists}
            hitSlop={8}
            style={[
              styles.groceryButton,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Grocery Lists"
          >
            <Feather name="shopping-cart" size={16} color={theme.link} />
            <ThemedText
              style={[styles.groceryButtonText, { color: theme.link }]}
            >
              Grocery Lists
            </ThemedText>
          </Pressable>
        </View>

        {/* Month/Year Header with arrows */}
        <View style={styles.monthHeader}>
          <Pressable
            onPress={handlePrevWeek}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <Feather name="chevron-left" size={20} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.monthTitle}>{monthYear}</ThemedText>
          <Pressable
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
              const dateStr = formatDate(date);
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

        {/* Meal Slots */}
        {selectedDayItems.length === 0 ? <MealPlanEmptyState /> : null}

        {MEAL_TYPES.map((mealType) => {
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
        })}

        {/* Daily Totals */}
        <DailyTotals items={selectedDayItems} />
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
      <QuickAddSheet
        mealType={quickAddMealType}
        plannedDate={selectedDateStr}
        onDismiss={handleQuickAddDismiss}
        onNavigateCreate={handleNavigateCreate}
        onNavigateImport={handleNavigateImport}
      />
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
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  dateStripItem: {
    width: 44,
    height: 64,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dateStripDayName: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  dateStripDayNum: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  dateStripDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dayLabel: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  mealSlotSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  mealSlotHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  mealSlotLabel: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  collapsedSummary: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  mealSlotItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.xs,
  },
  mealSlotContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  mealSlotName: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  mealSlotCalories: {
    fontSize: 13,
    marginTop: 2,
  },
  addItemButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.xs,
  },
  addItemText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  dailyTotals: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginTop: Spacing.sm,
  },
  dailyTotalsTitle: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  dailyTotalsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  dailyTotalItem: {
    alignItems: "center",
  },
  dailyTotalValue: {
    fontSize: 17,
    fontFamily: FontFamily.bold,
  },
  dailyTotalLabel: {
    fontSize: 11,
    marginTop: 2,
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
  topActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
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
  suggestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  suggestChipText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
