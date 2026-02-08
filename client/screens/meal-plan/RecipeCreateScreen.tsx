import React, { useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
  Keyboard,
  InteractionManager,
  AccessibilityInfo,
  findNodeHandle,
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SectionRow } from "@/components/recipe-builder/SectionRow";
import { SheetHeader } from "@/components/recipe-builder/SheetHeader";
import { TimeServingsSheet } from "@/components/recipe-builder/TimeServingsSheet";
import { NutritionSheet } from "@/components/recipe-builder/NutritionSheet";
import { TagsCuisineSheet } from "@/components/recipe-builder/TagsCuisineSheet";
import { IngredientsSheet } from "@/components/recipe-builder/IngredientsSheet";
import { InstructionsSheet } from "@/components/recipe-builder/InstructionsSheet";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useRecipeForm } from "@/hooks/useRecipeForm";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useCreateMealPlanRecipe } from "@/hooks/useMealPlanRecipes";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeCreateScreenNavigationProp } from "@/types/navigation";
import type {
  SheetSection,
  SheetLifecycleState,
} from "@/components/recipe-builder/types";

type RecipeCreateRouteProp = RouteProp<MealPlanStackParamList, "RecipeCreate">;

// Module-level snap point constants
const SNAP_TIME_SERVINGS = ["45%", "70%"];
const SNAP_NUTRITION = ["50%"];
const SNAP_TAGS = ["50%"];
const SNAP_INGREDIENTS = ["70%"];
const SNAP_INSTRUCTIONS = ["70%"];

export default function RecipeCreateScreen() {
  const navigation = useNavigation<RecipeCreateScreenNavigationProp>();
  const route = useRoute<RecipeCreateRouteProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const prefill = route.params?.prefill;
  const createMutation = useCreateMealPlanRecipe();

  const form = useRecipeForm(prefill);
  const sheetState = useRef<SheetLifecycleState>("IDLE");
  const activeSheetTrigger = useRef<View | null>(null);

  // Sheet refs
  const timeServingsRef = useRef<BottomSheetModal>(null);
  const nutritionRef = useRef<BottomSheetModal>(null);
  const tagsRef = useRef<BottomSheetModal>(null);
  const ingredientsRef = useRef<BottomSheetModal>(null);
  const instructionsRef = useRef<BottomSheetModal>(null);

  // Track which sheets have been opened (for lazy mounting)
  const [mountedSheets, setMountedSheets] = React.useState<Set<SheetSection>>(
    new Set(),
  );

  const sheetRefs: Record<
    SheetSection,
    React.RefObject<BottomSheetModal | null>
  > = {
    timeServings: timeServingsRef,
    nutrition: nutritionRef,
    tags: tagsRef,
    ingredients: ingredientsRef,
    instructions: instructionsRef,
  };

  // Section row trigger refs for focus return
  const sectionTriggerRefs: Record<
    SheetSection,
    React.RefObject<View | null>
  > = {
    timeServings: useRef<View>(null),
    nutrition: useRef<View>(null),
    tags: useRef<View>(null),
    ingredients: useRef<View>(null),
    instructions: useRef<View>(null),
  };

  // ── Sheet opening with keyboard sequencing ──
  const openSheet = useCallback(
    (section: SheetSection) => {
      if (sheetState.current !== "IDLE") return;
      sheetState.current = "SHEET_OPEN";
      activeSheetTrigger.current = sectionTriggerRefs[section].current;

      // Ensure sheet is mounted
      setMountedSheets((prev) => {
        if (prev.has(section)) return prev;
        const next = new Set(prev);
        next.add(section);
        return next;
      });

      // Dismiss keyboard first, then present sheet after animations settle
      Keyboard.dismiss();
      InteractionManager.runAfterInteractions(() => {
        sheetRefs[section].current?.present();
      });
    },
    // All captured values are stable refs and state setters — including them
    // would not change behavior but would obscure the intentional stability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleSheetDismiss = useCallback(() => {
    sheetState.current = "IDLE";
    // Return focus to the section row that triggered this sheet
    if (activeSheetTrigger.current) {
      const tag = findNodeHandle(activeSheetTrigger.current);
      if (tag) {
        requestAnimationFrame(() => {
          AccessibilityInfo.setAccessibilityFocus(tag);
        });
      }
    }
  }, []);

  // ── Backdrop renderer ──
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

  // ── Unsaved changes guard ──
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!form.isDirty || createMutation.isPending) {
        // Allow navigation if form is clean or save is in progress
        if (createMutation.isPending) {
          e.preventDefault();
        }
        return;
      }

      e.preventDefault();
      Alert.alert("Discard changes?", "You have unsaved changes.", [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });

    return unsubscribe;
  }, [navigation, form.isDirty, createMutation.isPending]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!form.title.trim()) {
      Alert.alert("Required", "Please enter a recipe title.");
      return;
    }
    if (sheetState.current !== "IDLE") return;

    sheetState.current = "SAVING";

    try {
      await createMutation.mutateAsync(form.formToPayload());
      haptics.notification(NotificationFeedbackType.Success);
      navigation.goBack();
    } catch {
      sheetState.current = "IDLE";
      Alert.alert("Error", "Failed to save recipe. Please try again.");
    }
  }, [form, haptics, createMutation, navigation]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.sm,
          paddingBottom: insets.bottom + Spacing.xl + 80,
          paddingHorizontal: Spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <TextInput
          style={[
            styles.titleInput,
            {
              color: theme.text,
              borderBottomColor: withOpacity(theme.text, 0.1),
            },
          ]}
          value={form.title}
          onChangeText={form.setTitle}
          placeholder="What are you making?"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          accessibilityLabel="Recipe title"
        />

        {/* Subtitle / Description */}
        <TextInput
          style={[styles.subtitleInput, { color: theme.textSecondary }]}
          value={form.description}
          onChangeText={form.setDescription}
          placeholder="Brief description (optional)"
          placeholderTextColor={withOpacity(theme.textSecondary, 0.6)}
          accessibilityLabel="Recipe description"
        />

        {/* Section Rows Card */}
        <View
          style={[
            styles.sectionsCard,
            {
              backgroundColor: theme.backgroundSecondary,
              borderRadius: BorderRadius.card,
            },
          ]}
        >
          <View ref={sectionTriggerRefs.ingredients}>
            <SectionRow
              icon="list"
              label="Ingredients"
              summary={form.ingredientsSummary}
              isFilled={!!form.ingredientsSummary}
              onPress={() => openSheet("ingredients")}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View ref={sectionTriggerRefs.instructions}>
            <SectionRow
              icon="file-text"
              label="Instructions"
              summary={form.instructionsSummary}
              isFilled={!!form.instructionsSummary}
              onPress={() => openSheet("instructions")}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View ref={sectionTriggerRefs.timeServings}>
            <SectionRow
              icon="clock"
              label="Time & Servings"
              summary={form.timeServingsSummary}
              isFilled={!!form.timeServingsSummary}
              onPress={() => openSheet("timeServings")}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View ref={sectionTriggerRefs.nutrition}>
            <SectionRow
              icon="activity"
              label="Nutrition"
              summary={form.nutritionSummary}
              isFilled={!!form.nutritionSummary}
              onPress={() => openSheet("nutrition")}
            />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View ref={sectionTriggerRefs.tags}>
            <SectionRow
              icon="tag"
              label="Tags & Cuisine"
              summary={form.tagsSummary}
              isFilled={!!form.tagsSummary}
              onPress={() => openSheet("tags")}
            />
          </View>
        </View>
      </ScrollView>

      {/* Save Button */}
      <View
        style={[
          styles.saveBar,
          {
            paddingBottom: insets.bottom + Spacing.md,
            backgroundColor: theme.backgroundRoot,
            borderTopColor: withOpacity(theme.text, 0.08),
          },
        ]}
      >
        <Pressable
          onPress={handleSave}
          disabled={createMutation.isPending}
          style={[
            styles.saveButton,
            {
              backgroundColor: createMutation.isPending
                ? withOpacity(theme.link, 0.5)
                : theme.link,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save recipe"
        >
          <ThemedText
            style={[styles.saveButtonText, { color: theme.buttonText }]}
          >
            {createMutation.isPending ? "Saving..." : "Save Recipe"}
          </ThemedText>
        </Pressable>
      </View>

      {/* ── Bottom Sheets ── */}

      {mountedSheets.has("ingredients") && (
        <BottomSheetModal
          ref={ingredientsRef}
          snapPoints={SNAP_INGREDIENTS}
          enableDynamicSizing={false}
          keyboardBehavior="extend"
          keyboardBlurBehavior="restore"
          backdropComponent={renderBackdrop}
          onDismiss={handleSheetDismiss}
          accessibilityViewIsModal
        >
          <SheetHeader
            title="Ingredients"
            onDone={() => ingredientsRef.current?.dismiss()}
          />
          <IngredientsSheet
            data={form.ingredients}
            onAdd={form.addIngredient}
            onRemove={form.removeIngredient}
            onUpdate={form.updateIngredient}
          />
        </BottomSheetModal>
      )}

      {mountedSheets.has("instructions") && (
        <BottomSheetModal
          ref={instructionsRef}
          snapPoints={SNAP_INSTRUCTIONS}
          enableDynamicSizing={false}
          keyboardBehavior="extend"
          keyboardBlurBehavior="restore"
          backdropComponent={renderBackdrop}
          onDismiss={handleSheetDismiss}
          accessibilityViewIsModal
        >
          <SheetHeader
            title="Instructions"
            onDone={() => instructionsRef.current?.dismiss()}
          />
          <InstructionsSheet
            data={form.steps}
            onAdd={form.addStep}
            onRemove={form.removeStep}
            onUpdate={form.updateStep}
            onMove={form.moveStep}
          />
        </BottomSheetModal>
      )}

      {mountedSheets.has("timeServings") && (
        <BottomSheetModal
          ref={timeServingsRef}
          snapPoints={SNAP_TIME_SERVINGS}
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          backdropComponent={renderBackdrop}
          onDismiss={handleSheetDismiss}
          accessibilityViewIsModal
        >
          <SheetHeader
            title="Time & Servings"
            onDone={() => timeServingsRef.current?.dismiss()}
          />
          <TimeServingsSheet
            data={form.timeServings}
            onChange={form.setTimeServings}
          />
        </BottomSheetModal>
      )}

      {mountedSheets.has("nutrition") && (
        <BottomSheetModal
          ref={nutritionRef}
          snapPoints={SNAP_NUTRITION}
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          backdropComponent={renderBackdrop}
          onDismiss={handleSheetDismiss}
          accessibilityViewIsModal
        >
          <SheetHeader
            title="Nutrition"
            onDone={() => nutritionRef.current?.dismiss()}
          />
          <NutritionSheet data={form.nutrition} onChange={form.setNutrition} />
        </BottomSheetModal>
      )}

      {mountedSheets.has("tags") && (
        <BottomSheetModal
          ref={tagsRef}
          snapPoints={SNAP_TAGS}
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          backdropComponent={renderBackdrop}
          onDismiss={handleSheetDismiss}
          accessibilityViewIsModal
        >
          <SheetHeader
            title="Tags & Cuisine"
            onDone={() => tagsRef.current?.dismiss()}
          />
          <TagsCuisineSheet data={form.tags} onChange={form.setTags} />
        </BottomSheetModal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  titleInput: {
    fontSize: 24,
    fontFamily: FontFamily.bold,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    marginBottom: Spacing.xs,
  },
  subtitleInput: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  sectionsCard: {
    overflow: "hidden",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.lg,
  },
  saveBar: {
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderTopWidth: 1,
  },
  saveButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
