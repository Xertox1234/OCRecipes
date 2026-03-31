import React, { useState, useCallback, useEffect } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  Pressable,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useRecipePhotoImport } from "@/hooks/useRecipePhotoImport";
import { mapPhotoResultToImportedRecipeData } from "@/lib/photo-upload";
import type { RecipePhotoResult } from "@/lib/photo-upload";
import { useCreateMealPlanRecipe } from "@/hooks/useMealPlanRecipes";
import { useAddMealPlanItem } from "@/hooks/useMealPlan";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipePhotoImportScreenNavigationProp } from "@/types/navigation";

type ScreenState = "analyzing" | "review" | "saving" | "error";

type RecipePhotoImportRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipePhotoImport"
>;

export default function RecipePhotoImportScreen() {
  const navigation = useNavigation<RecipePhotoImportScreenNavigationProp>();
  const route = useRoute<RecipePhotoImportRouteProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const { photoUri, returnToMealPlan } = route.params;
  const photoImportMutation = useRecipePhotoImport();
  const createRecipeMutation = useCreateMealPlanRecipe();
  const addItemMutation = useAddMealPlanItem();

  const [state, setState] = useState<ScreenState>("analyzing");
  const [result, setResult] = useState<RecipePhotoResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Analyze on mount
  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        const data = await photoImportMutation.mutateAsync(photoUri);
        if (cancelled) return;

        if (data.confidence > 0.3 && data.title) {
          setResult(data);
          setState("review");
        } else {
          setErrorMessage(
            "Could not extract a recipe from this image. Try a clearer photo.",
          );
          setState("error");
        }
      } catch (error) {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : "Analysis failed";
        setErrorMessage(msg);
        setState("error");
      }
    }

    analyze();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (state === "analyzing") {
      AccessibilityInfo.announceForAccessibility(
        "Extracting recipe from photo",
      );
    } else if (state === "review" && result) {
      AccessibilityInfo.announceForAccessibility(
        `Recipe extracted: ${result.title}`,
      );
    } else if (state === "error") {
      AccessibilityInfo.announceForAccessibility(
        `Import failed: ${errorMessage}`,
      );
    }
  }, [state, result, errorMessage]);

  const handleSave = useCallback(async () => {
    if (!result) return;
    setState("saving");
    haptics.impact();

    try {
      const recipe = await createRecipeMutation.mutateAsync({
        title: result.title,
        description: result.description,
        cuisine: result.cuisine,
        servings: result.servings ?? undefined,
        prepTimeMinutes: result.prepTimeMinutes,
        cookTimeMinutes: result.cookTimeMinutes,
        instructions: result.instructions
          ? result.instructions.split(/\n/).filter((s) => s.trim().length > 0)
          : undefined,
        dietTags: result.dietTags,
        sourceType: "photo_import",
        caloriesPerServing: result.caloriesPerServing,
        proteinPerServing: result.proteinPerServing,
        carbsPerServing: result.carbsPerServing,
        fatPerServing: result.fatPerServing,
        ingredients: result.ingredients.map((ing) => ({
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
        })),
      });

      if (returnToMealPlan) {
        await addItemMutation.mutateAsync({
          recipeId: recipe.id,
          mealType: returnToMealPlan.mealType,
          plannedDate: returnToMealPlan.plannedDate,
        });
      }

      haptics.notification(NotificationFeedbackType.Success);
      navigation.popToTop();
    } catch {
      setState("review");
      haptics.notification(NotificationFeedbackType.Error);
    }
  }, [
    result,
    haptics,
    createRecipeMutation,
    addItemMutation,
    returnToMealPlan,
    navigation,
  ]);

  const handleEdit = useCallback(() => {
    if (!result) return;
    haptics.impact();
    const prefill = mapPhotoResultToImportedRecipeData(result);
    navigation.navigate("RecipeCreate", { prefill, returnToMealPlan });
  }, [result, haptics, navigation, returnToMealPlan]);

  const handleTryAgain = useCallback(() => {
    setState("analyzing");
    setErrorMessage("");
    setResult(null);

    photoImportMutation.mutateAsync(photoUri).then(
      (data) => {
        if (data.confidence > 0.3 && data.title) {
          setResult(data);
          setState("review");
        } else {
          setErrorMessage(
            "Could not extract a recipe from this image. Try a clearer photo.",
          );
          setState("error");
        }
      },
      (error) => {
        const msg = error instanceof Error ? error.message : "Analysis failed";
        setErrorMessage(msg);
        setState("error");
      },
    );
  }, [photoUri, photoImportMutation]);

  const handleUrlImport = useCallback(() => {
    navigation.navigate("RecipeImport", { returnToMealPlan });
  }, [navigation, returnToMealPlan]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Analyzing State */}
        {state === "analyzing" && (
          <View accessibilityLiveRegion="polite" style={styles.centeredContent}>
            <ActivityIndicator size="large" color={theme.link} />
            <ThemedText
              style={[styles.loadingText, { color: theme.textSecondary }]}
            >
              Extracting recipe...
            </ThemedText>
          </View>
        )}

        {/* Saving State */}
        {state === "saving" && (
          <View accessibilityLiveRegion="polite" style={styles.centeredContent}>
            <ActivityIndicator size="large" color={theme.link} />
            <ThemedText
              style={[styles.loadingText, { color: theme.textSecondary }]}
            >
              Saving recipe...
            </ThemedText>
          </View>
        )}

        {/* Review State */}
        {state === "review" && result && (
          <View>
            <View
              style={[
                styles.successIcon,
                { backgroundColor: withOpacity(theme.success, 0.15) },
              ]}
            >
              <Feather name="check" size={32} color={theme.success} />
            </View>
            <ThemedText style={styles.heading}>Recipe Extracted</ThemedText>
            <View
              style={[
                styles.reviewCard,
                { backgroundColor: withOpacity(theme.text, 0.04) },
              ]}
            >
              <ThemedText style={styles.recipeTitle}>{result.title}</ThemedText>

              {/* Servings & Times */}
              <View style={styles.metaRow}>
                {result.servings && (
                  <View style={styles.metaItem}>
                    <Feather
                      name="users"
                      size={14}
                      color={theme.textSecondary}
                    />
                    <ThemedText
                      style={[styles.metaText, { color: theme.textSecondary }]}
                    >
                      {result.servings} servings
                    </ThemedText>
                  </View>
                )}
                {result.prepTimeMinutes != null && (
                  <View style={styles.metaItem}>
                    <Feather
                      name="clock"
                      size={14}
                      color={theme.textSecondary}
                    />
                    <ThemedText
                      style={[styles.metaText, { color: theme.textSecondary }]}
                    >
                      {result.prepTimeMinutes}m prep
                    </ThemedText>
                  </View>
                )}
                {result.cookTimeMinutes != null && (
                  <View style={styles.metaItem}>
                    <Feather
                      name="clock"
                      size={14}
                      color={theme.textSecondary}
                    />
                    <ThemedText
                      style={[styles.metaText, { color: theme.textSecondary }]}
                    >
                      {result.cookTimeMinutes}m cook
                    </ThemedText>
                  </View>
                )}
              </View>

              {/* Macros */}
              {result.caloriesPerServing != null && (
                <View
                  style={[
                    styles.macroRow,
                    {
                      backgroundColor: withOpacity(theme.text, 0.04),
                    },
                  ]}
                >
                  <View style={styles.macroItem}>
                    <ThemedText style={styles.macroValue}>
                      {Math.round(result.caloriesPerServing)}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.macroLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      cal
                    </ThemedText>
                  </View>
                  {result.proteinPerServing != null && (
                    <View style={styles.macroItem}>
                      <ThemedText style={styles.macroValue}>
                        {Math.round(result.proteinPerServing)}g
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.macroLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        protein
                      </ThemedText>
                    </View>
                  )}
                  {result.carbsPerServing != null && (
                    <View style={styles.macroItem}>
                      <ThemedText style={styles.macroValue}>
                        {Math.round(result.carbsPerServing)}g
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.macroLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        carbs
                      </ThemedText>
                    </View>
                  )}
                  {result.fatPerServing != null && (
                    <View style={styles.macroItem}>
                      <ThemedText style={styles.macroValue}>
                        {Math.round(result.fatPerServing)}g
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.macroLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        fat
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}

              {/* Ingredients preview */}
              {result.ingredients.length > 0 && (
                <View style={styles.ingredientsPreview}>
                  <ThemedText
                    style={[
                      styles.ingredientsLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {result.ingredients.length} ingredient
                    {result.ingredients.length !== 1 ? "s" : ""}
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.ingredientsList,
                      { color: theme.textSecondary },
                    ]}
                    numberOfLines={2}
                  >
                    {result.ingredients
                      .slice(0, 5)
                      .map((i) => i.name)
                      .join(", ")}
                    {result.ingredients.length > 5
                      ? `, +${result.ingredients.length - 5} more`
                      : ""}
                  </ThemedText>
                </View>
              )}
            </View>

            {/* Actions */}
            <Pressable
              onPress={handleSave}
              style={[styles.actionButton, { backgroundColor: theme.link }]}
              accessibilityRole="button"
              accessibilityLabel="Save recipe"
            >
              <ThemedText style={styles.actionButtonText}>
                Save Recipe
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleEdit}
              style={[
                styles.secondaryButton,
                { borderColor: withOpacity(theme.text, 0.15) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Edit before saving"
            >
              <ThemedText
                style={[styles.secondaryButtonText, { color: theme.link }]}
              >
                Edit Before Saving
              </ThemedText>
            </Pressable>
          </View>
        )}

        {/* Error State */}
        {state === "error" && (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={styles.centeredContent}
          >
            <View
              style={[
                styles.errorIcon,
                { backgroundColor: withOpacity(theme.error, 0.15) },
              ]}
            >
              <Feather name="alert-circle" size={32} color={theme.error} />
            </View>
            <ThemedText style={styles.heading}>Extraction Failed</ThemedText>
            <ThemedText
              style={[styles.errorText, { color: theme.textSecondary }]}
            >
              {errorMessage}
            </ThemedText>
            <Pressable
              onPress={handleTryAgain}
              style={[styles.actionButton, { backgroundColor: theme.link }]}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <ThemedText style={styles.actionButtonText}>Try Again</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleUrlImport}
              style={[
                styles.secondaryButton,
                { borderColor: withOpacity(theme.text, 0.15) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Import from URL instead"
            >
              <ThemedText
                style={[styles.secondaryButtonText, { color: theme.link }]}
              >
                Import from URL
              </ThemedText>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  loadingText: {
    fontSize: 15,
    marginTop: Spacing.lg,
  },
  heading: {
    fontSize: 22,
    fontFamily: FontFamily.bold,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  reviewCard: {
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  recipeTitle: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    marginBottom: Spacing.md,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 13,
  },
  macroRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  macroItem: {
    alignItems: "center",
  },
  macroValue: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  macroLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  ingredientsPreview: {
    gap: 4,
  },
  ingredientsLabel: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
  },
  ingredientsList: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  actionButtonText: {
    color: "#FFFFFF", // hardcoded
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  secondaryButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
});
