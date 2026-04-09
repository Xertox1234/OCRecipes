import React, { useState, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { IngredientIcon } from "@/components/IngredientIcon";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useGenerateMealPlanFromPantry,
  useSaveGeneratedMealPlan,
  type GeneratedDay,
  type GeneratedMeal,
} from "@/hooks/useGenerateMealPlan";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { toDateString } from "@shared/lib/date";

const DAY_OPTIONS = [3, 5, 7] as const;

const MEAL_TYPE_ICONS: Record<string, string> = {
  breakfast: "sunrise",
  lunch: "sun",
  dinner: "moon",
  snack: "coffee",
};

const MEAL_TYPE_ORDER = ["breakfast", "lunch", "dinner", "snack"];

function formatDate(startDate: string, dayOffset: number): string {
  const date = new Date(startDate + "T12:00:00");
  date.setDate(date.getDate() + dayOffset);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getPlannedDate(startDate: string, dayOffset: number): string {
  const date = new Date(startDate + "T12:00:00");
  date.setDate(date.getDate() + dayOffset);
  return toDateString(date);
}

function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateString(d);
}

export default function ReceiptMealPlanScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ReceiptMealPlan">>();

  const startDate = route.params?.startDate ?? getTomorrowDate();

  const [selectedDays, setSelectedDays] = useState<number>(3);
  const [plan, setPlan] = useState<GeneratedDay[] | null>(null);
  const [removedMeals, setRemovedMeals] = useState<Set<string>>(new Set());

  const generateMutation = useGenerateMealPlanFromPantry();
  const saveMutation = useSaveGeneratedMealPlan();

  const handleGenerate = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    setRemovedMeals(new Set());
    generateMutation.mutate(
      { days: selectedDays, startDate },
      {
        onSuccess: (result) => {
          haptics.notification(Haptics.NotificationFeedbackType.Success);
          setPlan(result.days);
        },
      },
    );
  }, [selectedDays, startDate, haptics, generateMutation]);

  const handleRemoveMeal = useCallback(
    (dayNumber: number, mealTitle: string) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setRemovedMeals((prev) => {
        const next = new Set(prev);
        next.add(`${dayNumber}:${mealTitle}`);
        return next;
      });
    },
    [haptics],
  );

  const visibleMeals = useMemo(() => {
    if (!plan) return [];
    return plan.map((day) => ({
      ...day,
      meals: day.meals.filter(
        (meal) => !removedMeals.has(`${day.dayNumber}:${meal.title}`),
      ),
    }));
  }, [plan, removedMeals]);

  const totalMealCount = useMemo(
    () => visibleMeals.reduce((sum, day) => sum + day.meals.length, 0),
    [visibleMeals],
  );

  const handleSave = useCallback(() => {
    if (totalMealCount === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Heavy);

    const mealsToSave = visibleMeals.flatMap((day) =>
      day.meals.map((meal) => ({
        ...meal,
        description: meal.description,
        instructions: meal.instructions,
        dietTags: meal.dietTags,
        difficulty: meal.difficulty,
        plannedDate: getPlannedDate(startDate, day.dayNumber - 1),
      })),
    );

    saveMutation.mutate(mealsToSave, {
      onSuccess: () => {
        haptics.notification(Haptics.NotificationFeedbackType.Success);
        navigation.popToTop();
      },
    });
  }, [
    visibleMeals,
    totalMealCount,
    startDate,
    haptics,
    saveMutation,
    navigation,
  ]);

  // Pre-generation view
  if (!plan && !generateMutation.isPending) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      >
        <ScrollView
          contentContainerStyle={[
            styles.setupContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
        >
          <View style={styles.iconContainer}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: withOpacity(theme.link, 0.12) },
              ]}
            >
              <Feather name="calendar" size={32} color={theme.link} />
            </View>
          </View>

          <ThemedText style={[styles.title, { color: theme.text }]}>
            Plan meals from your pantry
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            AI will create a meal plan using the ingredients you have,
            prioritizing items expiring soon.
          </ThemedText>

          {/* Day picker */}
          <ThemedText
            style={[styles.sectionLabel, { color: theme.textSecondary }]}
          >
            Plan duration
          </ThemedText>
          <View style={styles.dayPicker}>
            {DAY_OPTIONS.map((days) => {
              const isSelected = days === selectedDays;
              return (
                <Pressable
                  key={days}
                  onPress={() => setSelectedDays(days)}
                  style={[
                    styles.dayOption,
                    {
                      backgroundColor: isSelected
                        ? theme.link
                        : withOpacity(theme.text, 0.06),
                      borderColor: isSelected
                        ? theme.link
                        : withOpacity(theme.text, 0.12),
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${days} days`}
                >
                  <ThemedText
                    style={[
                      styles.dayOptionText,
                      {
                        color: isSelected ? theme.buttonText : theme.text,
                      },
                    ]}
                  >
                    {days} days
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <ThemedText
            style={[styles.startDateLabel, { color: theme.textSecondary }]}
          >
            Starting {formatDate(startDate, 0)}
          </ThemedText>

          {generateMutation.isError && (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: withOpacity(theme.error, 0.12) },
              ]}
            >
              <Feather name="alert-circle" size={16} color={theme.error} />
              <ThemedText style={[styles.errorText, { color: theme.error }]}>
                {generateMutation.error.message}
              </ThemedText>
            </View>
          )}

          <Pressable
            onPress={handleGenerate}
            style={[styles.generateButton, { backgroundColor: theme.link }]}
            accessibilityRole="button"
            accessibilityLabel="Generate meal plan"
          >
            <Feather
              name="zap"
              size={18}
              color={theme.buttonText}
              style={{ marginRight: Spacing.xs }}
            />
            <ThemedText
              style={[styles.generateButtonText, { color: theme.buttonText }]}
            >
              Generate Meal Plan
            </ThemedText>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // Loading state
  if (generateMutation.isPending) {
    return (
      <View
        style={[styles.centered, { backgroundColor: theme.backgroundDefault }]}
      >
        <ActivityIndicator size="large" color={theme.link} />
        <ThemedText
          style={[styles.loadingText, { color: theme.textSecondary }]}
        >
          Creating your meal plan...
        </ThemedText>
        <ThemedText
          style={[styles.loadingSubtext, { color: theme.textSecondary }]}
        >
          This may take 15–30 seconds
        </ThemedText>
      </View>
    );
  }

  // Plan results view
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.planContent,
          { paddingBottom: insets.bottom + 80 },
        ]}
      >
        {visibleMeals.map((day) => (
          <View key={day.dayNumber} style={styles.daySection}>
            <View
              style={[
                styles.dayHeader,
                { borderBottomColor: withOpacity(theme.text, 0.08) },
              ]}
            >
              <ThemedText style={[styles.dayTitle, { color: theme.text }]}>
                Day {day.dayNumber}
              </ThemedText>
              <ThemedText
                style={[styles.dayDate, { color: theme.textSecondary }]}
              >
                {formatDate(startDate, day.dayNumber - 1)}
              </ThemedText>
            </View>

            {day.meals.length === 0 ? (
              <ThemedText
                style={[styles.noMeals, { color: theme.textSecondary }]}
              >
                All meals removed for this day
              </ThemedText>
            ) : (
              day.meals
                .sort(
                  (a, b) =>
                    MEAL_TYPE_ORDER.indexOf(a.mealType) -
                    MEAL_TYPE_ORDER.indexOf(b.mealType),
                )
                .map((meal) => (
                  <MealCard
                    key={`${day.dayNumber}-${meal.title}`}
                    meal={meal}
                    onRemove={() => handleRemoveMeal(day.dayNumber, meal.title)}
                  />
                ))
            )}
          </View>
        ))}
      </ScrollView>

      {/* Bottom action bar */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: theme.backgroundSecondary,
            paddingBottom: insets.bottom + Spacing.sm,
            borderTopColor: withOpacity(theme.text, 0.08),
          },
        ]}
      >
        <Pressable
          onPress={handleSave}
          disabled={saveMutation.isPending || totalMealCount === 0}
          style={[
            styles.saveButton,
            {
              backgroundColor: theme.link,
              opacity: saveMutation.isPending || totalMealCount === 0 ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${totalMealCount} meals to plan`}
        >
          {saveMutation.isPending ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <ThemedText
              style={[styles.saveButtonText, { color: theme.buttonText }]}
            >
              Add to Meal Plan ({totalMealCount} meals)
            </ThemedText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================================
// MEAL CARD COMPONENT
// ============================================================================

function MealCard({
  meal,
  onRemove,
}: {
  meal: GeneratedMeal;
  onRemove: () => void;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const iconName = MEAL_TYPE_ICONS[meal.mealType] ?? "circle";

  return (
    <View
      style={[styles.mealCard, { backgroundColor: theme.backgroundSecondary }]}
    >
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.mealCardHeader}
        accessibilityRole="button"
        accessibilityLabel={`${meal.mealType}: ${meal.title}. ${meal.caloriesPerServing} calories per serving`}
        accessibilityHint={expanded ? "Collapse details" : "Expand details"}
      >
        <View style={styles.mealCardLeft}>
          <Feather
            name={iconName as keyof typeof Feather.glyphMap}
            size={16}
            color={theme.link}
          />
          <View style={styles.mealCardTitleArea}>
            <ThemedText
              style={[styles.mealType, { color: theme.textSecondary }]}
            >
              {meal.mealType.charAt(0).toUpperCase() + meal.mealType.slice(1)}
            </ThemedText>
            <ThemedText
              style={[styles.mealTitle, { color: theme.text }]}
              numberOfLines={expanded ? undefined : 1}
            >
              {meal.title}
            </ThemedText>
          </View>
        </View>

        <View style={styles.mealCardRight}>
          <ThemedText
            style={[styles.mealCalories, { color: theme.textSecondary }]}
          >
            {Math.round(meal.caloriesPerServing)} cal
          </ThemedText>
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${meal.title}`}
          >
            <Feather name="x" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      </Pressable>

      {expanded && (
        <View
          style={[
            styles.mealDetails,
            { borderTopColor: withOpacity(theme.text, 0.06) },
          ]}
        >
          <ThemedText
            style={[styles.mealDescription, { color: theme.textSecondary }]}
          >
            {meal.description}
          </ThemedText>

          {/* Macros */}
          <View style={styles.macroRow}>
            <MacroBadge
              label="P"
              value={meal.proteinPerServing}
              unit="g"
              color={theme.link}
            />
            <MacroBadge
              label="C"
              value={meal.carbsPerServing}
              unit="g"
              color={theme.warning}
            />
            <MacroBadge
              label="F"
              value={meal.fatPerServing}
              unit="g"
              color={theme.error}
            />
            <ThemedText
              style={[styles.prepTime, { color: theme.textSecondary }]}
            >
              <Feather name="clock" size={12} color={theme.textSecondary} />{" "}
              {meal.prepTimeMinutes + meal.cookTimeMinutes}m
            </ThemedText>
          </View>

          {/* Ingredients */}
          <ThemedText style={[styles.detailLabel, { color: theme.text }]}>
            Ingredients
          </ThemedText>
          {meal.ingredients.map((ing, i) => (
            <View key={i} style={styles.ingredientRow}>
              <IngredientIcon name={ing.name} size={20} />
              <ThemedText
                style={[
                  styles.ingredientText,
                  { color: theme.textSecondary, flex: 1 },
                ]}
              >
                {ing.quantity} {ing.unit} {ing.name}
              </ThemedText>
            </View>
          ))}

          {/* Instructions */}
          <ThemedText style={[styles.detailLabel, { color: theme.text }]}>
            Instructions
          </ThemedText>
          <ThemedText
            style={[styles.instructionsText, { color: theme.textSecondary }]}
          >
            {meal.instructions}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function MacroBadge({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
}) {
  return (
    <View
      style={[styles.macroBadge, { backgroundColor: withOpacity(color, 0.1) }]}
    >
      <ThemedText style={[styles.macroBadgeText, { color }]}>
        {Math.round(value)}
        {unit} {label}
      </ThemedText>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  loadingText: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: Spacing.lg,
  },
  loadingSubtext: {
    fontSize: 14,
    marginTop: Spacing.xs,
  },
  setupContent: {
    padding: Spacing.lg,
    alignItems: "center",
  },
  iconContainer: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontFamily: FontFamily.bold,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    marginTop: Spacing.sm,
    lineHeight: 22,
    paddingHorizontal: Spacing.md,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  dayPicker: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  dayOption: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  dayOptionText: {
    fontSize: 15,
    fontWeight: "600",
  },
  startDateLabel: {
    fontSize: 14,
    marginTop: Spacing.md,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
    width: "100%",
  },
  errorText: {
    fontSize: 14,
    flex: 1,
  },
  generateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xl,
    width: "100%",
  },
  generateButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  planContent: {
    padding: Spacing.md,
  },
  daySection: {
    marginBottom: Spacing.lg,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    marginBottom: Spacing.sm,
  },
  dayTitle: {
    fontSize: 18,
    fontFamily: FontFamily.bold,
  },
  dayDate: {
    fontSize: 14,
  },
  noMeals: {
    fontSize: 14,
    fontStyle: "italic",
    padding: Spacing.md,
  },
  mealCard: {
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    overflow: "hidden",
  },
  mealCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
  },
  mealCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.sm,
  },
  mealCardTitleArea: {
    flex: 1,
  },
  mealType: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  mealTitle: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
    marginTop: 2,
  },
  mealCardRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  mealCalories: {
    fontSize: 13,
    fontWeight: "500",
  },
  mealDetails: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
  },
  mealDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: Spacing.sm,
  },
  macroRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    alignItems: "center",
  },
  macroBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
  },
  macroBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  prepTime: {
    fontSize: 12,
    marginLeft: Spacing.xs,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  ingredientText: {
    fontSize: 13,
    lineHeight: 20,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  instructionsText: {
    fontSize: 13,
    lineHeight: 20,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
  },
  saveButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
});
