// client/components/recipe-wizard/WizardShell.tsx
import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  AccessibilityInfo,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Animated, {
  SlideInRight,
  SlideOutLeft,
  SlideInLeft,
  SlideOutRight,
  FadeIn,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useRecipeForm } from "@/hooks/useRecipeForm";
import { useCreateMealPlanRecipe } from "@/hooks/useMealPlanRecipes";
import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import { inferCuisine, inferDietTags } from "@/lib/recipe-tag-inference";
import {
  STEP_CONFIGS,
  STEP_INGREDIENTS,
  STEP_INSTRUCTIONS,
  STEP_NUTRITION,
  STEP_PREVIEW,
  STEP_TAGS,
  STEP_TIME_SERVINGS,
  STEP_TITLE,
  TOTAL_STEPS,
  type WizardStep,
} from "./types";
import TitleStep from "./TitleStep";
import IngredientsStep from "./IngredientsStep";
import InstructionsStep from "./InstructionsStep";
import TimeServingsStep from "./TimeServingsStep";
import NutritionStep from "./NutritionStep";
import TagsStep from "./TagsStep";
import PreviewStep from "./PreviewStep";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

interface WizardShellProps {
  prefill?: ImportedRecipeData;
  returnToMealPlan?: { mealType: string; plannedDate: string };
  onGoBack: () => void;
  onSaveComplete: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

export default function WizardShell({
  prefill,
  returnToMealPlan,
  onGoBack,
  onSaveComplete,
  onDirtyChange,
  onSavingChange,
}: WizardShellProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const insets = useSafeAreaInsets();
  // Stable refs so useRecipeForm + handleSave always see the latest callbacks
  // without re-invoking their internal callbacks on every render.
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const onSavingChangeRef = useRef(onSavingChange);
  onSavingChangeRef.current = onSavingChange;

  // Action-driven dirty propagation: useRecipeForm fires onDirtyChange when
  // isDirty actually transitions. No derived useEffect needed.
  const form = useRecipeForm(prefill, {
    onDirtyChange: useCallback(
      (dirty: boolean) => onDirtyChangeRef.current?.(dirty),
      [],
    ),
  });
  const createMutation = useCreateMealPlanRecipe();
  const addItemMutation = useAddMealPlanItem();

  const [currentStep, setCurrentStep] = useState<WizardStep>(STEP_TITLE);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [returnToPreview, setReturnToPreview] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [hasSuggestedTags, setHasSuggestedTags] = useState(false);

  const stepConfig = STEP_CONFIGS[currentStep - 1];

  const applySuggestions = useCallback(() => {
    if (hasSuggestedTags) return;
    setHasSuggestedTags(true);

    const ingredientNames = form.ingredients
      .filter((i) => i.text.trim())
      .map((i) => i.text.trim());

    const suggestedCuisine = inferCuisine(form.title, ingredientNames);
    const suggestedDietTags = inferDietTags(ingredientNames);

    if (!form.tags.cuisine && suggestedCuisine) {
      form.setTags({
        ...form.tags,
        cuisine: suggestedCuisine,
        dietTags:
          suggestedDietTags.length > 0 ? suggestedDietTags : form.tags.dietTags,
      });
    } else if (
      form.tags.dietTags.length === 0 &&
      suggestedDietTags.length > 0
    ) {
      form.setTags({ ...form.tags, dietTags: suggestedDietTags });
    }
  }, [form, hasSuggestedTags]);

  const validateStep = useCallback((): boolean => {
    setValidationError("");
    switch (currentStep) {
      case STEP_TITLE:
        if (form.title.trim().length < 3) {
          setValidationError("Recipe name must be at least 3 characters");
          return false;
        }
        return true;
      case STEP_INGREDIENTS: {
        const hasIngredient = form.ingredients.some((i) => i.text.trim());
        if (!hasIngredient) {
          setValidationError("Add at least one ingredient");
          return false;
        }
        return true;
      }
      case STEP_INSTRUCTIONS: {
        const hasStep = form.steps.some((s) => s.text.trim());
        if (!hasStep) {
          setValidationError("Add at least one instruction step");
          return false;
        }
        return true;
      }
      default:
        return true;
    }
  }, [currentStep, form.title, form.ingredients, form.steps]);

  const goNext = useCallback(() => {
    if (!validateStep()) return;
    setDirection("forward");

    if (returnToPreview) {
      setReturnToPreview(false);
      // Return to Preview is always a "forward" direction semantically —
      // the user is progressing back toward the final summary, not stepping
      // backward through the wizard. direction is already "forward" here.
      setCurrentStep(STEP_PREVIEW);
      return;
    }

    const nextStep = (currentStep + 1) as WizardStep;
    if (nextStep === STEP_TAGS) applySuggestions();
    setCurrentStep(nextStep);
    setValidationError("");

    AccessibilityInfo.announceForAccessibility(
      `Step ${nextStep} of ${TOTAL_STEPS}, ${STEP_CONFIGS[nextStep - 1].title}`,
    );
  }, [currentStep, validateStep, returnToPreview, applySuggestions]);

  const goBack = useCallback(() => {
    setDirection("back");
    setValidationError("");

    if (currentStep === STEP_TITLE) {
      // Screen-level beforeRemove listener owns the unsaved-changes prompt;
      // delegating here avoids a double-alert on discard.
      onGoBack();
      return;
    }

    if (returnToPreview) {
      setReturnToPreview(false);
      // Return to Preview is semantically "forward" — Preview is the last
      // step. Discarding edit changes and going back to Preview should feel
      // like moving ahead, not retreating further into the wizard.
      setDirection("forward");
      setCurrentStep(STEP_PREVIEW);
      return;
    }

    const prevStep = (currentStep - 1) as WizardStep;
    setCurrentStep(prevStep);

    AccessibilityInfo.announceForAccessibility(
      `Step ${prevStep} of ${TOTAL_STEPS}, ${STEP_CONFIGS[prevStep - 1].title}`,
    );
  }, [currentStep, onGoBack, returnToPreview]);

  const editFromPreview = useCallback((targetStep: WizardStep) => {
    setReturnToPreview(true);
    setDirection("back");
    setCurrentStep(targetStep);
    AccessibilityInfo.announceForAccessibility(
      `Step ${targetStep} of ${TOTAL_STEPS}, ${STEP_CONFIGS[targetStep - 1].title}`,
    );
  }, []);

  const handleSave = useCallback(async () => {
    // Fire onSavingChange from the action itself — action-driven (no derived
    // useEffect on mutation state). Note: "saving" spans BOTH createMutation
    // and addItemMutation; the parent is notified for the full chain, not
    // just createMutation.isPending as the pre-L22 effect tracked.
    onSavingChangeRef.current?.(true);
    try {
      const payload = form.formToPayload();
      const created = await createMutation.mutateAsync(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (returnToMealPlan) {
        await addItemMutation.mutateAsync({
          recipeId: created.id,
          mealType: returnToMealPlan.mealType,
          plannedDate: returnToMealPlan.plannedDate,
        });
      }

      onSaveComplete();
    } catch {
      Alert.alert("Error", "Failed to save recipe. Please try again.");
    } finally {
      onSavingChangeRef.current?.(false);
    }
  }, [form, createMutation, addItemMutation, returnToMealPlan, onSaveComplete]);

  const isNutritionEmpty =
    !form.nutrition.calories &&
    !form.nutrition.protein &&
    !form.nutrition.carbs &&
    !form.nutrition.fat;

  const nextButtonLabel = useMemo(() => {
    if (currentStep === STEP_PREVIEW) return "Save Recipe";
    if (currentStep === STEP_NUTRITION && isNutritionEmpty) return "Skip";
    return `Next: ${stepConfig.nextLabel}`;
  }, [currentStep, isNutritionEmpty, stepConfig.nextLabel]);

  // Respect reduced motion — skip the slide animation, still remount via key.
  const entering = reducedMotion
    ? undefined
    : direction === "forward"
      ? SlideInRight.duration(250)
      : SlideInLeft.duration(250);
  const exiting = reducedMotion
    ? undefined
    : direction === "forward"
      ? SlideOutLeft.duration(250)
      : SlideOutRight.duration(250);

  const renderStep = () => {
    switch (currentStep) {
      case STEP_TITLE:
        return (
          <TitleStep
            title={form.title}
            setTitle={form.setTitle}
            description={form.description}
            setDescription={form.setDescription}
          />
        );
      case STEP_INGREDIENTS:
        return (
          <IngredientsStep
            ingredients={form.ingredients}
            addIngredient={form.addIngredient}
            removeIngredient={form.removeIngredient}
            updateIngredient={form.updateIngredient}
          />
        );
      case STEP_INSTRUCTIONS:
        return (
          <InstructionsStep
            steps={form.steps}
            addStep={form.addStep}
            removeStep={form.removeStep}
            updateStep={form.updateStep}
            moveStep={form.moveStep}
          />
        );
      case STEP_TIME_SERVINGS:
        return (
          <TimeServingsStep
            timeServings={form.timeServings}
            setTimeServings={form.setTimeServings}
          />
        );
      case STEP_NUTRITION:
        return (
          <NutritionStep
            nutrition={form.nutrition}
            setNutrition={form.setNutrition}
          />
        );
      case STEP_TAGS:
        return <TagsStep tags={form.tags} setTags={form.setTags} />;
      case STEP_PREVIEW:
        return <PreviewStep form={form} onEditStep={editFromPreview} />;
      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                {
                  backgroundColor:
                    i < currentStep
                      ? theme.link
                      : withOpacity(theme.link, 0.12),
                },
              ]}
            />
          ))}
        </View>
        <Text
          style={[styles.stepLabel, { color: theme.link }]}
          accessibilityRole="text"
          accessibilityLabel={`Step ${currentStep} of ${TOTAL_STEPS}, ${stepConfig.title}`}
        >
          Step {currentStep} of {TOTAL_STEPS}
        </Text>
      </View>

      {/* Step Title */}
      <View style={styles.headerContainer}>
        <Text style={[styles.title, { color: theme.text }]}>
          {stepConfig.title}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {stepConfig.subtitle}
        </Text>
      </View>

      {/* Step Content */}
      <View style={styles.contentContainer}>
        <Animated.View
          key={`step-${currentStep}`}
          entering={entering}
          exiting={exiting}
          style={styles.stepContent}
        >
          {renderStep()}
        </Animated.View>
      </View>

      {/* Validation Error */}
      {validationError ? (
        <Animated.View
          entering={reducedMotion ? undefined : FadeIn.duration(200)}
          style={styles.errorContainer}
        >
          <Text style={[styles.errorText, { color: theme.error }]}>
            {validationError}
          </Text>
        </Animated.View>
      ) : null}

      {/* Navigation Buttons */}
      <View
        style={[
          styles.navContainer,
          { paddingBottom: Math.max(insets.bottom, Spacing.md) },
        ]}
      >
        {currentStep > STEP_TITLE && (
          <Pressable
            onPress={goBack}
            style={[
              styles.navButton,
              styles.backButton,
              { backgroundColor: theme.backgroundSecondary },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${STEP_CONFIGS[currentStep - 2]?.title ?? "Entry Hub"}`}
          >
            <Text style={[styles.navButtonText, { color: theme.link }]}>
              ← Back
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={currentStep === STEP_PREVIEW ? handleSave : goNext}
          disabled={createMutation.isPending}
          style={[
            styles.navButton,
            styles.nextButton,
            { backgroundColor: theme.link },
            currentStep === STEP_TITLE && styles.fullWidth,
            createMutation.isPending && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={nextButtonLabel}
        >
          <Text style={[styles.navButtonText, { color: theme.buttonText }]}>
            {createMutation.isPending ? "Saving..." : nextButtonLabel}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  progressContainer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  progressBar: { flexDirection: "row", gap: 3 },
  progressSegment: { flex: 1, height: 4, borderRadius: 2 },
  stepLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    marginTop: Spacing.xs,
  },
  headerContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: { fontFamily: FontFamily.bold, fontSize: 22 },
  subtitle: { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  contentContainer: { flex: 1, overflow: "hidden" },
  stepContent: { flex: 1, paddingHorizontal: Spacing.lg },
  errorContainer: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
  errorText: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    textAlign: "center",
  },
  navContainer: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  navButton: {
    paddingVertical: 12,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: { flex: 1 },
  nextButton: { flex: 2 },
  fullWidth: { flex: 1 },
  navButtonText: { fontFamily: FontFamily.semiBold, fontSize: 14 },
});
