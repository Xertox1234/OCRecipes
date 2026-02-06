import React, { useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useMealPlanItems, useRemoveMealPlanItem } from "@/hooks/useMealPlan";
import type { MealPlanHomeScreenNavigationProp } from "@/types/navigation";
import type { MealPlanItem, MealPlanRecipe, ScannedItem } from "@shared/schema";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
const MEAL_ICONS: Record<string, string> = {
  breakfast: "sunrise",
  lunch: "sun",
  dinner: "moon",
  snack: "coffee",
};
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
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

type MealPlanItemWithRelations = MealPlanItem & {
  recipe: MealPlanRecipe | null;
  scannedItem: ScannedItem | null;
};

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
          { color: isSelected ? "#FFFFFF" : theme.textSecondary },
        ]}
      >
        {dayName}
      </ThemedText>
      <ThemedText
        style={[
          styles.dateStripDayNum,
          { color: isSelected ? "#FFFFFF" : theme.text },
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
  onPress,
  onRemove,
}: {
  item: MealPlanItemWithRelations;
  onPress: (item: MealPlanItemWithRelations) => void;
  onRemove: (id: number) => void;
}) {
  const { theme } = useTheme();
  const name =
    item.recipe?.title || item.scannedItem?.productName || "Unknown item";
  const calories =
    item.recipe?.caloriesPerServing || item.scannedItem?.calories || null;
  const servings = parseFloat(item.servings || "1");
  const totalCal = calories
    ? Math.round(parseFloat(calories) * servings)
    : null;

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={[
        styles.mealSlotItem,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${name}${totalCal ? `, ${totalCal} calories` : ""}`}
    >
      <View style={styles.mealSlotContent}>
        <ThemedText style={styles.mealSlotName} numberOfLines={1}>
          {name}
        </ThemedText>
        {totalCal !== null && (
          <ThemedText
            style={[styles.mealSlotCalories, { color: theme.textSecondary }]}
          >
            {totalCal} cal
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

function MealSlotSection({
  mealType,
  items,
  onItemPress,
  onRemoveItem,
  onAddItem,
}: {
  mealType: string;
  items: MealPlanItemWithRelations[];
  onItemPress: (item: MealPlanItemWithRelations) => void;
  onRemoveItem: (id: number) => void;
  onAddItem: (mealType: string) => void;
}) {
  const { theme } = useTheme();
  const iconName = MEAL_ICONS[mealType] || "circle";
  const label = MEAL_LABELS[mealType] || mealType;

  return (
    <View style={styles.mealSlotSection}>
      <View style={styles.mealSlotHeader}>
        <Feather
          name={iconName as keyof typeof Feather.glyphMap}
          size={16}
          color={theme.link}
        />
        <ThemedText style={styles.mealSlotLabel}>{label}</ThemedText>
      </View>
      {items.map((item) => (
        <MealSlotItem
          key={item.id}
          item={item}
          onPress={onItemPress}
          onRemove={onRemoveItem}
        />
      ))}
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
  );
}

// ── Daily Totals ─────────────────────────────────────────────────────

function DailyTotals({ items }: { items: MealPlanItemWithRelations[] }) {
  const { theme } = useTheme();

  const totals = useMemo(() => {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;

    for (const item of items) {
      const servings = parseFloat(item.servings || "1");
      const recipe = item.recipe;
      const scannedItem = item.scannedItem;

      if (recipe) {
        calories += parseFloat(recipe.caloriesPerServing || "0") * servings;
        protein += parseFloat(recipe.proteinPerServing || "0") * servings;
        carbs += parseFloat(recipe.carbsPerServing || "0") * servings;
        fat += parseFloat(recipe.fatPerServing || "0") * servings;
      } else if (scannedItem) {
        calories += parseFloat(scannedItem.calories || "0") * servings;
        protein += parseFloat(scannedItem.protein || "0") * servings;
        carbs += parseFloat(scannedItem.carbs || "0") * servings;
        fat += parseFloat(scannedItem.fat || "0") * servings;
      }
    }

    return {
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
    };
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
}

// ── Empty State ──────────────────────────────────────────────────────

function EmptyState() {
  const { theme } = useTheme();

  return (
    <View style={styles.emptyState}>
      <Feather name="calendar" size={48} color={withOpacity(theme.text, 0.2)} />
      <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
        Plan Your Meals
      </ThemedText>
      <ThemedText
        style={[styles.emptySubtitle, { color: theme.textSecondary }]}
      >
        {'Tap "+ Add item" on any meal slot to start building your daily plan.'}
      </ThemedText>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────

export default function MealPlanHomeScreen() {
  const navigation = useNavigation<MealPlanHomeScreenNavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const queryClient = useQueryClient();

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [selectedDate, setSelectedDate] = useState(today);

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

  const selectedDateStr = formatDate(selectedDate);
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
    haptics.selection();
    setSelectedDate((prev) => addDays(prev, 7));
  }, [haptics]);

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

  const handleAddItem = useCallback(
    (_mealType: string) => {
      haptics.selection();
      // TODO: Phase 2 will add RecipeBrowser navigation
      // For now, users can create recipes via the API
    },
    [haptics],
  );

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] });
  }, [queryClient]);

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
            paddingBottom: tabBarHeight,
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
      >
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

        {/* Date Strip */}
        <View style={styles.dateStrip}>
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
        </View>

        {/* Day Label */}
        <ThemedText style={styles.dayLabel}>
          {getDayLabel(selectedDate)}
        </ThemedText>

        {/* Meal Slots */}
        {selectedDayItems.length === 0 ? <EmptyState /> : null}

        {MEAL_TYPES.map((mealType) => (
          <MealSlotSection
            key={mealType}
            mealType={mealType}
            items={itemsByMealType[mealType] || []}
            onItemPress={handleItemPress}
            onRemoveItem={handleRemoveItem}
            onAddItem={handleAddItem}
          />
        ))}

        {/* Daily Totals */}
        <DailyTotals items={selectedDayItems} />
      </ScrollView>
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
  mealSlotItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.xs,
  },
  mealSlotContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  mealSlotName: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
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
});
