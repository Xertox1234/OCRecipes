import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import {
  PREPARATION_OPTIONS,
  type FoodCategory,
} from "@shared/constants/preparation";
import {
  useCookSessionQuery,
  useEditIngredient,
  useDeleteIngredient,
  useCookNutrition,
  useLogCookSession,
  useCookRecipe,
  useCookSubstitutions,
} from "@/hooks/useCookSession";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type {
  CookingSessionIngredient,
  CookSessionNutritionSummary,
} from "@shared/types/cook-session";

export default function CookSessionReviewScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { confirm, ConfirmationModal } = useConfirmationModal();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "CookSessionReview">>();
  const { features } = usePremiumContext();

  const { sessionId } = route.params;
  const { data: session } = useCookSessionQuery(sessionId);

  const [nutrition, setNutrition] =
    useState<CookSessionNutritionSummary | null>(null);
  const [isLoadingNutrition, setIsLoadingNutrition] = useState(false);

  const editIngredient = useEditIngredient(sessionId);
  const deleteIngredient = useDeleteIngredient(sessionId);
  const nutritionMutation = useCookNutrition(sessionId);
  const logSession = useLogCookSession(sessionId);
  const recipeMutation = useCookRecipe(sessionId);
  const substitutionsMutation = useCookSubstitutions(sessionId);

  const ingredients = useMemo(
    () => session?.ingredients ?? [],
    [session?.ingredients],
  );

  // Fetch nutrition on mount and when ingredients change
  useEffect(() => {
    if (ingredients.length > 0 && sessionId) {
      setIsLoadingNutrition(true);
      nutritionMutation
        .mutateAsync({})
        .then((data) => {
          setNutrition(data);
        })
        .catch(() => {
          // Nutrition lookup may fail silently
        })
        .finally(() => {
          setIsLoadingNutrition(false);
        });
    }
    // Only re-fetch when ingredients change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredients.length, sessionId]);

  const handleDelete = useCallback(
    (ingredientId: string, name: string) => {
      confirm({
        title: "Remove Ingredient",
        message: `Remove ${name}?`,
        confirmLabel: "Remove",
        destructive: true,
        onConfirm: async () => {
          await deleteIngredient.mutateAsync(ingredientId);
          AccessibilityInfo.announceForAccessibility(`${name} removed`);
        },
      });
    },
    [confirm, deleteIngredient],
  );

  const handlePreparationChange = useCallback(
    async (ingredientId: string, method: string) => {
      await editIngredient.mutateAsync({
        ingredientId,
        updates: { preparationMethod: method },
      });
      // Re-fetch nutrition
      const data = await nutritionMutation.mutateAsync({});
      setNutrition(data);
    },
    [editIngredient, nutritionMutation],
  );

  const handleLogMeal = useCallback(async () => {
    try {
      await logSession.mutateAsync({});
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Meal logged successfully");
      navigation.popTo("Main");
    } catch {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Failed to log meal. Please try again.");
    }
  }, [logSession, haptics, toast, navigation]);

  const handleGenerateRecipe = useCallback(async () => {
    try {
      const recipe = await recipeMutation.mutateAsync();
      Alert.alert(recipe.title, recipe.description);
    } catch {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Failed to generate recipe. Please try again.");
    }
  }, [recipeMutation, haptics, toast]);

  const handleSubstitutions = useCallback(async () => {
    try {
      const result = await substitutionsMutation.mutateAsync({});
      navigation.replace("SubstitutionResult", {
        sessionId,
        result,
        ingredients,
      });
    } catch {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Failed to get substitutions. Please try again.");
    }
  }, [
    substitutionsMutation,
    haptics,
    toast,
    navigation,
    sessionId,
    ingredients,
  ]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return theme.success;
    if (confidence >= 0.5) return theme.warning;
    return theme.error;
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return "High";
    if (confidence >= 0.5) return "Medium";
    return "Low";
  };

  const renderIngredient = ({ item }: { item: CookingSessionIngredient }) => {
    const prepOptions =
      PREPARATION_OPTIONS[item.category as FoodCategory] ??
      PREPARATION_OPTIONS.other;

    return (
      <Card style={styles.ingredientCard}>
        <View style={styles.ingredientRow}>
          <View style={styles.ingredientInfo}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {item.name}
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {item.quantity} {item.unit}
            </ThemedText>
            <View style={styles.confidenceRow}>
              <View
                style={[
                  styles.confidenceDot,
                  { backgroundColor: getConfidenceColor(item.confidence) },
                ]}
              />
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {getConfidenceLabel(item.confidence)} confidence
              </ThemedText>
            </View>
          </View>

          {/* Preparation method picker */}
          <View style={styles.prepContainer}>
            <ScrollablePrepPicker
              options={prepOptions}
              selected={item.preparationMethod ?? "As Served"}
              onSelect={(method) => handlePreparationChange(item.id, method)}
              theme={theme}
            />
          </View>

          {/* Delete button */}
          <Pressable
            onPress={() => handleDelete(item.id, item.name)}
            style={styles.deleteButton}
            accessibilityLabel={`Remove ${item.name}`}
            accessibilityRole="button"
          >
            <Feather name="trash-2" size={18} color={theme.error} />
          </Pressable>
        </View>
      </Card>
    );
  };

  const isActionLoading =
    logSession.isPending ||
    recipeMutation.isPending ||
    substitutionsMutation.isPending;

  return (
    <ThemedView style={styles.container} accessibilityViewIsModal={true}>
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={ingredients}
        keyExtractor={(item) => item.id}
        renderItem={renderIngredient}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 200 },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="h2">
              {ingredients.length} Ingredient
              {ingredients.length !== 1 ? "s" : ""}
            </ThemedText>
          </View>
        }
        ListFooterComponent={
          nutrition ? (
            <NutritionSummaryCard nutrition={nutrition} theme={theme} />
          ) : isLoadingNutrition ? (
            <View style={styles.nutritionLoading}>
              <ActivityIndicator size="small" color={theme.success} />
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Calculating nutrition...
              </ThemedText>
            </View>
          ) : null
        }
      />

      {/* Action Hub */}
      <View
        style={[
          styles.actionHub,
          {
            paddingBottom: insets.bottom + Spacing.md,
            backgroundColor: theme.backgroundDefault,
            borderTopColor: withOpacity(theme.border, 0.3),
          },
        ]}
      >
        <Pressable
          style={[styles.actionButton, { backgroundColor: theme.success }]}
          onPress={handleLogMeal}
          disabled={isActionLoading || ingredients.length === 0}
          accessibilityLabel="Log meal"
          accessibilityRole="button"
        >
          {logSession.isPending ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <>
              <Feather name="check-circle" size={20} color={theme.buttonText} />
              <ThemedText type="body" style={styles.actionText}>
                Log Meal
              </ThemedText>
            </>
          )}
        </Pressable>

        <View style={styles.secondaryActions}>
          <Pressable
            style={[
              styles.secondaryButton,
              { borderColor: theme.border },
              !features.recipeGeneration && { opacity: 0.5 },
            ]}
            onPress={handleGenerateRecipe}
            disabled={
              isActionLoading ||
              !features.recipeGeneration ||
              ingredients.length === 0
            }
            accessibilityLabel={
              features.recipeGeneration
                ? "Generate recipe"
                : "Generate recipe (premium)"
            }
            accessibilityRole="button"
          >
            {recipeMutation.isPending ? (
              <ActivityIndicator size="small" color={theme.link} />
            ) : (
              <>
                <Feather name="book-open" size={18} color={theme.link} />
                <ThemedText
                  type="small"
                  style={{ color: theme.link, fontWeight: "600" }}
                >
                  Recipe
                </ThemedText>
              </>
            )}
          </Pressable>

          <Pressable
            style={[styles.secondaryButton, { borderColor: theme.border }]}
            onPress={handleSubstitutions}
            disabled={isActionLoading || ingredients.length === 0}
            accessibilityLabel="Get substitution suggestions"
            accessibilityRole="button"
          >
            {substitutionsMutation.isPending ? (
              <ActivityIndicator size="small" color={theme.link} />
            ) : (
              <>
                <Feather name="repeat" size={18} color={theme.link} />
                <ThemedText
                  type="small"
                  style={{ color: theme.link, fontWeight: "600" }}
                >
                  Substitutes
                </ThemedText>
              </>
            )}
          </Pressable>
        </View>
      </View>
      <ConfirmationModal />
    </ThemedView>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function ScrollablePrepPicker({
  options,
  selected,
  onSelect,
  theme,
}: {
  options: string[];
  selected: string;
  onSelect: (method: string) => void;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  return (
    <View style={styles.prepPicker}>
      {options.slice(0, 3).map((option) => (
        <Pressable
          key={option}
          onPress={() => onSelect(option)}
          style={[
            styles.prepChip,
            {
              backgroundColor:
                selected === option
                  ? withOpacity(theme.success, 0.15)
                  : withOpacity(theme.border, 0.3),
            },
          ]}
          accessibilityLabel={`${option} preparation`}
          accessibilityState={{ selected: selected === option }}
        >
          <ThemedText
            type="small"
            style={{
              color: selected === option ? theme.success : theme.textSecondary,
              fontWeight: selected === option ? "600" : "400",
            }}
          >
            {option}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

function NutritionSummaryCard({
  nutrition,
  theme,
}: {
  nutrition: CookSessionNutritionSummary;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  return (
    <Card
      style={styles.nutritionCard}
      accessibilityLabel={`Total nutrition: ${nutrition.total.calories} calories, ${nutrition.total.protein}g protein, ${nutrition.total.carbs}g carbs, ${nutrition.total.fat}g fat`}
    >
      <ThemedText
        type="body"
        style={{ fontWeight: "700", marginBottom: Spacing.md }}
      >
        Nutrition Summary
      </ThemedText>

      <View style={styles.macroRow}>
        <MacroItem
          label="Calories"
          value={`${nutrition.total.calories}`}
          color={theme.warning}
        />
        <MacroItem
          label="Protein"
          value={`${nutrition.total.protein}g`}
          color={theme.success}
        />
        <MacroItem
          label="Carbs"
          value={`${nutrition.total.carbs}g`}
          color={theme.link}
        />
        <MacroItem
          label="Fat"
          value={`${nutrition.total.fat}g`}
          color={theme.error}
        />
      </View>

      <View style={styles.microRow}>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Fiber: {nutrition.total.fiber}g • Sugar: {nutrition.total.sugar}g •
          Sodium: {nutrition.total.sodium}mg
        </ThemedText>
      </View>
    </Card>
  );
}

function MacroItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.macroItem}>
      <ThemedText type="h2" style={{ color, fontSize: 20, fontWeight: "700" }}>
        {value}
      </ThemedText>
      <ThemedText type="small" style={{ color, opacity: 0.8 }}>
        {label}
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
  listContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    marginBottom: Spacing.sm,
  },
  ingredientCard: {
    padding: Spacing.md,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  ingredientInfo: {
    flex: 1,
    gap: 2,
  },
  confidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  prepContainer: {
    maxWidth: 160,
  },
  prepPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  prepChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  deleteButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  nutritionCard: {
    padding: Spacing.lg,
    marginTop: Spacing.md,
  },
  macroRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  macroItem: {
    alignItems: "center",
    gap: 2,
  },
  microRow: {
    marginTop: Spacing.md,
    alignItems: "center",
  },
  nutritionLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  actionHub: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    borderTopWidth: 1,
    gap: Spacing.md,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  actionText: {
    color: "#FFFFFF", // hardcoded
    fontWeight: "700",
  },
  secondaryActions: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
