// client/components/recipe-wizard/WizardShell.tsx
import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  AccessibilityInfo,
  Alert,
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
import { STEP_CONFIGS, TOTAL_STEPS, type WizardStep } from "./types";
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
  const insets = useSafeAreaInsets();
  const form = useRecipeForm(prefill);
  const createMutation = useCreateMealPlanRecipe();
  const addItemMutation = useAddMealPlanItem();

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [returnToPreview, setReturnToPreview] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [hasSuggestedTags, setHasSuggestedTags] = useState(false);

  // Sync dirty/saving state to parent for beforeRemove guard
  useEffect(() => {
    onDirtyChange?.(form.isDirty);
  }, [form.isDirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(createMutation.isPending);
  }, [createMutation.isPending, onSavingChange]);

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
      case 1:
        if (form.title.trim().length < 3) {
          setValidationError("Recipe name must be at least 3 characters");
          return false;
        }
        return true;
      case 2: {
        const hasIngredient = form.ingredients.some((i) => i.text.trim());
        if (!hasIngredient) {
          setValidationError("Add at least one ingredient");
          return false;
        }
        return true;
      }
      case 3: {
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
      setCurrentStep(7);
      return;
    }

    const nextStep = (currentStep + 1) as WizardStep;
    if (nextStep === 6) applySuggestions();
    setCurrentStep(nextStep);
    setValidationError("");

    AccessibilityInfo.announceForAccessibility(
      `Step ${nextStep} of ${TOTAL_STEPS}, ${STEP_CONFIGS[nextStep - 1].title}`,
    );
  }, [currentStep, validateStep, returnToPreview, applySuggestions]);

  const goBack = useCallback(() => {
    setDirection("back");
    setValidationError("");

    if (currentStep === 1) {
      if (form.isDirty) {
        Alert.alert(
          "Discard changes?",
          "You have unsaved changes. Are you sure you want to go back?",
          [
            { text: "Keep editing", style: "cancel" },
            { text: "Discard", style: "destructive", onPress: onGoBack },
          ],
        );
        return;
      }
      onGoBack();
      return;
    }

    if (returnToPreview) {
      setReturnToPreview(false);
      setCurrentStep(7);
      return;
    }

    const prevStep = (currentStep - 1) as WizardStep;
    setCurrentStep(prevStep);

    AccessibilityInfo.announceForAccessibility(
      `Step ${prevStep} of ${TOTAL_STEPS}, ${STEP_CONFIGS[prevStep - 1].title}`,
    );
  }, [currentStep, onGoBack, returnToPreview, form.isDirty]);

  const editFromPreview = useCallback((targetStep: WizardStep) => {
    setReturnToPreview(true);
    setDirection("back");
    setCurrentStep(targetStep);
  }, []);

  const handleSave = useCallback(async () => {
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
    }
  }, [form, createMutation, addItemMutation, returnToMealPlan, onSaveComplete]);

  const isNutritionEmpty =
    !form.nutrition.calories &&
    !form.nutrition.protein &&
    !form.nutrition.carbs &&
    !form.nutrition.fat;

  const nextButtonLabel = useMemo(() => {
    if (currentStep === 7) return "Save Recipe";
    if (currentStep === 5 && isNutritionEmpty) return "Skip";
    return `Next: ${stepConfig.nextLabel}`;
  }, [currentStep, isNutritionEmpty, stepConfig.nextLabel]);

  const entering =
    direction === "forward"
      ? SlideInRight.duration(250)
      : SlideInLeft.duration(250);
  const exiting =
    direction === "forward"
      ? SlideOutLeft.duration(250)
      : SlideOutRight.duration(250);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <TitleStep
            title={form.title}
            setTitle={form.setTitle}
            description={form.description}
            setDescription={form.setDescription}
          />
        );
      case 2:
        return (
          <IngredientsStep
            ingredients={form.ingredients}
            addIngredient={form.addIngredient}
            removeIngredient={form.removeIngredient}
            updateIngredient={form.updateIngredient}
          />
        );
      case 3:
        return (
          <InstructionsStep
            steps={form.steps}
            addStep={form.addStep}
            removeStep={form.removeStep}
            updateStep={form.updateStep}
            moveStep={form.moveStep}
          />
        );
      case 4:
        return (
          <TimeServingsStep
            timeServings={form.timeServings}
            setTimeServings={form.setTimeServings}
          />
        );
      case 5:
        return (
          <NutritionStep
            nutrition={form.nutrition}
            setNutrition={form.setNutrition}
          />
        );
      case 6:
        return <TagsStep tags={form.tags} setTags={form.setTags} />;
      case 7:
        return <PreviewStep form={form} onEditStep={editFromPreview} />;
      default:
        return null;
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
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
          entering={FadeIn.duration(200)}
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
        {currentStep > 1 && (
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
          onPress={currentStep === 7 ? handleSave : goNext}
          disabled={createMutation.isPending}
          style={[
            styles.navButton,
            styles.nextButton,
            { backgroundColor: theme.link },
            currentStep === 1 && styles.fullWidth,
            createMutation.isPending && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={nextButtonLabel}
        >
          <Text
            style={[styles.navButtonText, { color: "#FFFFFF" /* hardcoded */ }]}
          >
            {createMutation.isPending ? "Saving..." : nextButtonLabel}
          </Text>
        </Pressable>
      </View>
    </View>
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
