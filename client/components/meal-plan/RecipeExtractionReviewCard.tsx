import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { IngredientIcon } from "@/components/IngredientIcon";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { RecipePhotoResult } from "@/lib/photo-upload";

interface RecipeExtractionReviewCardProps {
  result: RecipePhotoResult;
  onSave: () => void;
}

/**
 * "Recipe Extracted" review card shown after a successful photo or
 * pasted-text extraction, before the user hands off to the create wizard.
 * Shared between RecipePhotoImportScreen and RecipeTextImportScreen so the
 * two flows can't visually drift apart.
 */
export function RecipeExtractionReviewCard({
  result,
  onSave,
}: RecipeExtractionReviewCardProps) {
  const { theme } = useTheme();

  return (
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

        <View style={styles.metaRow}>
          {result.servings && (
            <View style={styles.metaItem}>
              <Feather name="users" size={14} color={theme.textSecondary} />
              <ThemedText
                style={[styles.metaText, { color: theme.textSecondary }]}
              >
                {result.servings} servings
              </ThemedText>
            </View>
          )}
          {result.prepTimeMinutes != null && (
            <View style={styles.metaItem}>
              <Feather name="clock" size={14} color={theme.textSecondary} />
              <ThemedText
                style={[styles.metaText, { color: theme.textSecondary }]}
              >
                {result.prepTimeMinutes}m prep
              </ThemedText>
            </View>
          )}
          {result.cookTimeMinutes != null && (
            <View style={styles.metaItem}>
              <Feather name="clock" size={14} color={theme.textSecondary} />
              <ThemedText
                style={[styles.metaText, { color: theme.textSecondary }]}
              >
                {result.cookTimeMinutes}m cook
              </ThemedText>
            </View>
          )}
        </View>

        {result.caloriesPerServing != null && (
          <View
            style={[
              styles.macroRow,
              { backgroundColor: withOpacity(theme.text, 0.04) },
            ]}
          >
            <View style={styles.macroItem}>
              <ThemedText style={styles.macroValue}>
                {Math.round(result.caloriesPerServing)}
              </ThemedText>
              <ThemedText
                style={[styles.macroLabel, { color: theme.textSecondary }]}
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
                  style={[styles.macroLabel, { color: theme.textSecondary }]}
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
                  style={[styles.macroLabel, { color: theme.textSecondary }]}
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
                  style={[styles.macroLabel, { color: theme.textSecondary }]}
                >
                  fat
                </ThemedText>
              </View>
            )}
          </View>
        )}

        {result.ingredients.length > 0 && (
          <View style={styles.ingredientsPreview}>
            <ThemedText
              style={[styles.ingredientsLabel, { color: theme.textSecondary }]}
            >
              {result.ingredients.length} ingredient
              {result.ingredients.length !== 1 ? "s" : ""}
            </ThemedText>
            {result.ingredients.slice(0, 5).map((ing, idx) => (
              <View key={idx} style={styles.ingredientRow}>
                <IngredientIcon name={ing.name} size={20} />
                <ThemedText
                  style={[
                    styles.ingredientsList,
                    { color: theme.textSecondary, flex: 1 },
                  ]}
                  numberOfLines={1}
                >
                  {ing.quantity} {ing.unit} {ing.name}
                </ThemedText>
              </View>
            ))}
            {result.ingredients.length > 5 && (
              <ThemedText
                style={[styles.ingredientsList, { color: theme.textSecondary }]}
              >
                +{result.ingredients.length - 5} more
              </ThemedText>
            )}
          </View>
        )}
      </View>

      <Pressable
        onPress={onSave}
        style={[styles.actionButton, { backgroundColor: theme.accentSolid }]}
        accessibilityRole="button"
        accessibilityLabel="Review and save recipe"
      >
        <ThemedText style={styles.actionButtonText}>
          Review &amp; Save
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  heading: {
    fontSize: 22,
    fontFamily: FontFamily.bold,
    textAlign: "center",
    marginBottom: Spacing.sm,
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
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
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
});
