import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View, Pressable } from "react-native";
import type { TextInput } from "react-native-gesture-handler";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetTextInput,
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useUnifiedRecipes } from "@/hooks/useMealPlanRecipes";
import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { MealType } from "@/screens/meal-plan/meal-plan-utils";

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const SNAP_POINTS = ["70%"];

interface QuickAddSheetProps {
  mealType: MealType | null;
  plannedDate: string;
  onDismiss: () => void;
  onNavigateCreate: (mealType: MealType, plannedDate: string) => void;
  onNavigateImport: (mealType: MealType, plannedDate: string) => void;
}

type RecipeRow = {
  id: number;
  title: string;
  calories: string | null;
  source: "personal" | "community";
};

function QuickAddSheetInner({
  mealType,
  plannedDate,
  onDismiss,
  onNavigateCreate,
  onNavigateImport,
}: QuickAddSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const sheetRef = useRef<BottomSheetModal>(null);
  const inputRef = useRef<TextInput>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Open/close sheet based on mealType
  useEffect(() => {
    if (mealType) {
      sheetRef.current?.present();
      setSearchQuery("");
      setDebouncedQuery("");
    } else {
      sheetRef.current?.dismiss();
    }
  }, [mealType]);

  const queryParams = debouncedQuery ? { query: debouncedQuery } : undefined;
  const { data, isLoading } = useUnifiedRecipes(queryParams);

  const addItemMutation = useAddMealPlanItem();

  const recipes: RecipeRow[] = useMemo(() => {
    if (!data) return [];

    if (debouncedQuery) {
      // Combine personal + community when searching
      const personal: RecipeRow[] = data.personal.map((r) => ({
        id: r.id,
        title: r.title,
        calories: r.caloriesPerServing,
        source: "personal" as const,
      }));
      const community: RecipeRow[] = data.community.map((r) => ({
        id: r.id,
        title: r.title,
        calories: null, // CommunityRecipe doesn't have per-serving macros
        source: "community" as const,
      }));
      return [...personal, ...community];
    }

    // No query: show first 8 personal recipes
    return data.personal.slice(0, 8).map((r) => ({
      id: r.id,
      title: r.title,
      calories: r.caloriesPerServing,
      source: "personal" as const,
    }));
  }, [data, debouncedQuery]);

  const handleAdd = useCallback(
    (recipe: RecipeRow) => {
      if (!mealType || addItemMutation.isPending) return;
      haptics.impact(ImpactFeedbackStyle.Light);
      addItemMutation.mutate(
        {
          recipeId: recipe.id,
          plannedDate,
          mealType,
        },
        {
          onSuccess: () => {
            haptics.notification(NotificationFeedbackType.Success);
            onDismiss();
          },
          onError: () => {
            haptics.notification(NotificationFeedbackType.Error);
          },
        },
      );
    },
    [mealType, plannedDate, haptics, addItemMutation, onDismiss],
  );

  const handleCreateRecipe = useCallback(() => {
    if (!mealType) return;
    onDismiss();
    onNavigateCreate(mealType, plannedDate);
  }, [mealType, plannedDate, onDismiss, onNavigateCreate]);

  const handleImportRecipe = useCallback(() => {
    if (!mealType) return;
    onDismiss();
    onNavigateImport(mealType, plannedDate);
  }, [mealType, plannedDate, onDismiss, onNavigateImport]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.35}
        pressBehavior="close"
      />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: RecipeRow }) => {
      const cal = item.calories
        ? `${Math.round(parseFloat(item.calories))} cal`
        : null;
      return (
        <Pressable
          onPress={() => handleAdd(item)}
          style={[
            styles.resultRow,
            { backgroundColor: withOpacity(theme.text, 0.03) },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${item.title}${cal ? `, ${cal}` : ""} to ${mealType}`}
        >
          <View style={styles.resultContent}>
            <ThemedText style={styles.resultTitle} numberOfLines={1}>
              {item.title}
            </ThemedText>
            {cal && (
              <ThemedText
                style={[styles.resultCal, { color: theme.textSecondary }]}
              >
                {cal}
              </ThemedText>
            )}
          </View>
          <Feather name="plus-circle" size={20} color={theme.link} />
        </Pressable>
      );
    },
    [handleAdd, theme, mealType],
  );

  const sectionTitle = debouncedQuery ? "Results" : "Your Recipes";
  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";

  const ListHeader = useMemo(
    () => (
      <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        {sectionTitle}
      </ThemedText>
    ),
    [sectionTitle, theme.textSecondary],
  );

  const ListEmpty = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.skeletonContainer}>
          {[1, 2, 3].map((i) => (
            <SkeletonBox
              key={i}
              width="100%"
              height={52}
              borderRadius={BorderRadius.card}
            />
          ))}
        </View>
      );
    }
    return (
      <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
        No recipes found
      </ThemedText>
    );
  }, [isLoading, theme.textSecondary]);

  const ListFooter = useMemo(
    () => (
      <View style={styles.footerActions}>
        <Pressable
          onPress={handleCreateRecipe}
          style={[
            styles.footerButton,
            { borderColor: withOpacity(theme.text, 0.1) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create new recipe"
        >
          <Feather name="edit-3" size={16} color={theme.link} />
          <ThemedText style={[styles.footerButtonText, { color: theme.link }]}>
            Create new recipe
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={handleImportRecipe}
          style={[
            styles.footerButton,
            { borderColor: withOpacity(theme.text, 0.1) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Import from URL"
        >
          <Feather name="link" size={16} color={theme.link} />
          <ThemedText style={[styles.footerButtonText, { color: theme.link }]}>
            Import from URL
          </ThemedText>
        </Pressable>
      </View>
    ),
    [handleCreateRecipe, handleImportRecipe, theme],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      onDismiss={onDismiss}
      onChange={(index) => {
        if (index === 0) {
          inputRef.current?.focus();
        }
      }}
      accessibilityViewIsModal
    >
      {/* Header */}
      <View style={styles.header}>
        <View
          style={[
            styles.dragIndicator,
            { backgroundColor: withOpacity(theme.text, 0.2) },
          ]}
        />
        <View style={styles.headerRow}>
          <ThemedText style={styles.headerTitle}>Add to {label}</ThemedText>
          <Pressable
            onPress={onDismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <ThemedText style={[styles.doneText, { color: theme.link }]}>
              Done
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: withOpacity(theme.text, 0.05) },
          ]}
        >
          <Feather name="search" size={16} color={theme.textSecondary} />
          <BottomSheetTextInput
            ref={inputRef}
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search recipes..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search recipes"
          />
        </View>
      </View>

      {/* Results */}
      <BottomSheetFlatList
        data={recipes}
        keyExtractor={(item: RecipeRow) => `${item.source}-${item.id}`}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </BottomSheetModal>
  );
}

export const QuickAddSheet = React.memo(QuickAddSheetInner);

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingTop: Spacing.sm,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  doneText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  searchContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingVertical: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.xs,
  },
  resultContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  resultTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  resultCal: {
    fontSize: 13,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: Spacing.xl,
  },
  skeletonContainer: {
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  footerActions: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  footerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.sm,
  },
  footerButtonText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
});
