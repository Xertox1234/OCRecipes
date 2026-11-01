import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  Pressable,
  type TextInputInstance,
} from "react-native";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { FocusBottomSheetTextInput } from "@/components/FocusBottomSheetTextInput";
import { InlineMicButton } from "@/components/InlineMicButton";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import {
  resolvePlaceholder,
  shouldFloatLabel,
} from "@/components/text-input-utils";
import { Feather } from "@expo/vector-icons";
import { ImpactFeedbackStyle } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SheetHeader } from "@/components/sheet/SheetChrome";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useUnifiedRecipes } from "@/hooks/useMealPlanRecipes";
import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import { formatPlanAddSuccess } from "@/components/coach/coach-chat-utils";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  MEAL_LABELS,
  type MealType,
} from "@/screens/meal-plan/meal-plan-utils";
import {
  resolveQuickAddAction,
  quickAddRowAccessibilityLabel,
} from "@/components/meal-plan/quick-add-utils";

export const QUICK_ADD_SNAP_POINTS = ["70%"];

const SEARCH_LABEL = "Search recipes";
const SEARCH_ICON_SIZE = 16;
// The search box's text starts past its left padding, the icon and the gap.
const SEARCH_LABEL_LEFT = Spacing.md + SEARCH_ICON_SIZE + Spacing.sm;

interface QuickAddSheetContentProps {
  mealType: MealType | null;
  plannedDate: string;
  onDismiss: () => void;
  onNavigateCreate: (mealType: MealType, plannedDate: string) => void;
  onOpenImportSheet: (mealType: MealType, plannedDate: string) => void;
  /** Community rows open the recipe detail; their id is NOT a meal-plan recipe id. */
  onOpenCommunityRecipe: (communityRecipeId: number) => void;
}

export interface QuickAddSheetContentHandle {
  focusSearchInput: () => void;
}

type RecipeRow = {
  id: number;
  title: string;
  calories: string | null;
  source: "personal" | "community";
};

function QuickAddSheetContentInner(
  {
    mealType,
    plannedDate,
    onDismiss,
    onNavigateCreate,
    onOpenImportSheet,
    onOpenCommunityRecipe,
  }: QuickAddSheetContentProps,
  forwardedRef: React.Ref<QuickAddSheetContentHandle>,
) {
  const { theme } = useTheme();
  // One focus ring for the whole box, not one nested around the inner input.
  const searchBoxFocus = useFieldFocus();
  const haptics = useHaptics();
  const toast = useToast();
  const inputRef = useRef<TextInputInstance>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useImperativeHandle(forwardedRef, () => ({
    focusSearchInput: () => inputRef.current?.focus(),
  }));

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Voice input REPLACES the search text with the dictated words.
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();
  // false once the sheet closes, so a late final result cannot refill.
  const voiceActiveRef = useRef(false);
  useEffect(() => {
    if (voiceActiveRef.current && transcript && (isListening || isFinal)) {
      setSearchQuery(transcript);
    }
  }, [isListening, isFinal, transcript]);
  useEffect(() => {
    if (speechError) toast.error(speechError);
  }, [speechError, toast]);
  const handleVoicePress = useCallback(() => {
    haptics.impact(ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      voiceActiveRef.current = true;
      void startListening();
    }
  }, [haptics, isListening, startListening, stopListening]);

  // Reset search state whenever the sheet is opened for a meal type. Keyed on
  // mealType only: depending on isListening here would re-run it when
  // recognition starts and wipe the dictation.
  useEffect(() => {
    voiceActiveRef.current = false;
    if (mealType) {
      setSearchQuery("");
      setDebouncedQuery("");
    }
  }, [mealType]);

  // Stop any in-progress voice capture when the sheet closes.
  useEffect(() => {
    if (!mealType && isListening) stopListening();
  }, [mealType, isListening, stopListening]);

  const queryParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (debouncedQuery) p.query = debouncedQuery;
    if (mealType) p.mealType = mealType;
    return Object.keys(p).length > 0 ? p : undefined;
  }, [debouncedQuery, mealType]);
  const { data, isLoading, isError } = useUnifiedRecipes(queryParams);

  const addItemMutation = useAddMealPlanItem();
  const isAdding = useRef(false);

  const frequentRecipes: RecipeRow[] = useMemo(() => {
    if (!data?.frequent.length || debouncedQuery) return [];
    return data.frequent.map((r) => ({
      id: r.id,
      title: r.title,
      calories: r.caloriesPerServing,
      source: "personal" as const,
    }));
  }, [data?.frequent, debouncedQuery]);

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

    // No query: show personal recipes, excluding those already in frequent
    const frequentIds = new Set(frequentRecipes.map((r) => r.id));
    return data.personal
      .filter((r) => !frequentIds.has(r.id))
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        title: r.title,
        calories: r.caloriesPerServing,
        source: "personal" as const,
      }));
  }, [data, debouncedQuery, frequentRecipes]);

  const handleAdd = useCallback(
    async (recipe: RecipeRow) => {
      if (!mealType || isAdding.current) return;
      const action = resolveQuickAddAction(recipe);
      if (action.kind === "view-community") {
        // A community id is not a meal-plan recipe id — never add it directly.
        haptics.impact(ImpactFeedbackStyle.Light);
        onDismiss();
        onOpenCommunityRecipe(action.communityRecipeId);
        return;
      }
      isAdding.current = true;
      haptics.impact(ImpactFeedbackStyle.Light);
      try {
        await addItemMutation.mutateAsync({
          recipeId: action.recipeId,
          plannedDate,
          mealType,
        });
        // The sheet closes, so confirm with a toast (fires its own Success).
        toast.success(formatPlanAddSuccess(plannedDate, mealType));
        onDismiss();
      } catch {
        toast.error("Couldn't add the recipe to your plan. Please try again.");
      } finally {
        isAdding.current = false;
      }
    },
    [
      mealType,
      plannedDate,
      haptics,
      toast,
      addItemMutation,
      onDismiss,
      onOpenCommunityRecipe,
    ],
  );

  const handleCreateRecipe = useCallback(() => {
    if (!mealType) return;
    onDismiss();
    onNavigateCreate(mealType, plannedDate);
  }, [mealType, plannedDate, onDismiss, onNavigateCreate]);

  const handleImportRecipe = useCallback(() => {
    if (!mealType) return;
    onDismiss();
    onOpenImportSheet(mealType, plannedDate);
  }, [mealType, plannedDate, onDismiss, onOpenImportSheet]);

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
          accessibilityLabel={quickAddRowAccessibilityLabel(
            item,
            cal,
            mealType,
          )}
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
          <Feather
            name={item.source === "community" ? "chevron-right" : "plus-circle"}
            size={20}
            color={theme.link}
            accessible={false}
          />
        </Pressable>
      );
    },
    [handleAdd, theme, mealType],
  );

  const sectionTitle = debouncedQuery ? "Results" : "Your Recipes";
  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";
  const frequentLabel = mealType
    ? `Frequent for ${MEAL_LABELS[mealType] || mealType}`
    : "Frequent";

  const ListHeader = useMemo(
    () => (
      <View>
        {frequentRecipes.length > 0 && (
          <>
            <ThemedText
              style={[styles.sectionTitle, { color: theme.textSecondary }]}
            >
              {frequentLabel}
            </ThemedText>
            {frequentRecipes.map((item) => {
              const cal = item.calories
                ? `${Math.round(parseFloat(item.calories))} cal`
                : null;
              return (
                <Pressable
                  key={`freq-${item.id}`}
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
                        style={[
                          styles.resultCal,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {cal}
                      </ThemedText>
                    )}
                  </View>
                  <Feather name="plus-circle" size={20} color={theme.link} />
                </Pressable>
              );
            })}
          </>
        )}
        <ThemedText
          style={[
            styles.sectionTitle,
            { color: theme.textSecondary },
            frequentRecipes.length > 0 && { marginTop: Spacing.md },
          ]}
        >
          {sectionTitle}
        </ThemedText>
      </View>
    ),
    [sectionTitle, frequentLabel, frequentRecipes, theme, mealType, handleAdd],
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
        {isError
          ? "Couldn't load recipes. Check your connection and try again."
          : "No recipes found"}
      </ThemedText>
    );
  }, [isLoading, isError, theme.textSecondary]);

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
          accessibilityLabel="Import a recipe"
        >
          <Feather name="download" size={16} color={theme.link} />
          <ThemedText style={[styles.footerButtonText, { color: theme.link }]}>
            Import a recipe
          </ThemedText>
        </Pressable>
      </View>
    ),
    [handleCreateRecipe, handleImportRecipe, theme],
  );

  return (
    // No existing single content root here (the sheet previously returned a
    // bare Fragment of 3 siblings) — accessibilityViewIsModal needs one
    // ancestor View spanning all of the sheet's own content for VoiceOver to
    // trap focus inside it. Uses a plain View, not BottomSheetView: gorhom's
    // BottomSheetView calls useFocusHook(handleSettingScrollable) on mount
    // (node_modules/@gorhom/bottom-sheet BottomSheetView.tsx ~line 79), which
    // registers itself as the sheet's SCROLLABLE_TYPE.VIEW scrollable driver —
    // nesting the BottomSheetFlatList below inside it risks two components
    // racing to claim that role. A plain View has no such registration. flex: 1
    // preserves the previous column layout. iOS-only prop; BottomSheetModal
    // typechecks it but never forwards it, so it must live on this inner
    // View, not the modal. See docs/solutions/conventions/
    // a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md.
    <View style={styles.rootContent} accessibilityViewIsModal>
      {/* Header */}
      <SheetHeader title={`Add to ${label}`} onDone={onDismiss} />

      {/* Search */}
      <View style={styles.searchContainer}>
        <FocusField
          focus={searchBoxFocus}
          label={SEARCH_LABEL}
          hasValue={searchQuery.length > 0}
          labelLeft={SEARCH_LABEL_LEFT}
          style={[
            styles.searchBox,
            { backgroundColor: withOpacity(theme.text, 0.05) },
          ]}
        >
          <Feather
            name="search"
            size={SEARCH_ICON_SIZE}
            color={theme.textSecondary}
          />
          <FocusBottomSheetTextInput
            ref={inputRef}
            focusRing={false}
            onFocus={searchBoxFocus.onFocus}
            onBlur={searchBoxFocus.onBlur}
            style={[styles.searchInput, { color: theme.text }]}
            // The label rests where the placeholder would; it shows once floated.
            placeholder={resolvePlaceholder(
              SEARCH_LABEL,
              "e.g. pasta or high protein",
              shouldFloatLabel(searchBoxFocus.focused, searchQuery),
            )}
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel={SEARCH_LABEL}
          />
          <InlineMicButton
            isListening={isListening}
            volume={volume}
            onPress={handleVoicePress}
          />
        </FocusField>
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
    </View>
  );
}

export const QuickAddSheetContent = React.memo(
  React.forwardRef(QuickAddSheetContentInner),
);

const styles = StyleSheet.create({
  // flex: 1 reproduces the pre-existing layout: this View simply replaces a
  // bare Fragment (see the accessibilityViewIsModal comment above) as the
  // ancestor of the same 3 siblings, so it must fill the same space they
  // previously filled directly.
  rootContent: {
    flex: 1,
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
  // Labelled field: the value sits under the floated label's row.
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    ...LABELLED_INPUT_TEXT,
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
