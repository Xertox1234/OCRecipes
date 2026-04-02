import React, { useState, useCallback } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
  AccessibilityInfo,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { RecipeDietTags } from "@/components/recipe-detail/RecipeDietTags";
import type { StreamingRecipe } from "@/hooks/useChat";

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface RecipeCardProps {
  recipe: StreamingRecipe;
  allergenWarning?: string | null;
  isImageLoading?: boolean;
  isSaved?: boolean;
  onSave?: () => void;
  isSaving?: boolean;
}

const IMAGE_HEIGHT = 180;

function RecipeCardInner({
  recipe,
  allergenWarning,
  isImageLoading,
  isSaved,
  onSave,
  isSaving,
}: RecipeCardProps) {
  const { theme } = useTheme();
  const [ingredientsExpanded, setIngredientsExpanded] = useState(false);
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);

  const toggleIngredients = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIngredientsExpanded((prev) => !prev);
    Haptics.selectionAsync();
  }, []);

  const toggleInstructions = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setInstructionsExpanded((prev) => !prev);
    Haptics.selectionAsync();
  }, []);

  const handleSave = useCallback(() => {
    if (isSaved || isSaving || !onSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave();
  }, [isSaved, isSaving, onSave]);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundRoot,
          borderColor: withOpacity(theme.text, 0.1),
        },
      ]}
      accessible
      accessibilityRole="none"
      accessibilityLabel={`Recipe: ${recipe.title}. ${recipe.difficulty}, ${recipe.timeEstimate}, ${recipe.servings} servings`}
    >
      {/* Image */}
      <View style={styles.imageContainer}>
        {isImageLoading || !recipe.imageUrl ? (
          <SkeletonBox
            width="100%"
            height={IMAGE_HEIGHT}
            borderRadius={BorderRadius.card}
          />
        ) : (
          <FallbackImage
            source={{ uri: recipe.imageUrl }}
            style={styles.image}
            fallbackIcon="image"
            fallbackIconSize={32}
            resizeMode="cover"
          />
        )}
      </View>

      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <ThemedText type="h4">{recipe.title}</ThemedText>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: 2 }}
          >
            {recipe.difficulty} {"\u00B7"} {recipe.timeEstimate} {"\u00B7"}{" "}
            {recipe.servings} servings
          </ThemedText>
        </View>
      </View>

      {/* Description */}
      {recipe.description ? (
        <ThemedText
          type="body"
          style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}
        >
          {recipe.description}
        </ThemedText>
      ) : null}

      {/* Expandable Ingredients */}
      <Pressable
        onPress={toggleIngredients}
        style={[
          styles.expandHeader,
          { borderTopColor: withOpacity(theme.text, 0.06) },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Ingredients, ${recipe.ingredients.length} items`}
        accessibilityState={{ expanded: ingredientsExpanded }}
      >
        <View style={styles.expandHeaderLeft}>
          <Feather
            name="list"
            size={16}
            color={theme.textSecondary}
            accessible={false}
          />
          <ThemedText type="body" style={{ marginLeft: Spacing.sm }}>
            Ingredients ({recipe.ingredients.length})
          </ThemedText>
        </View>
        <Feather
          name={ingredientsExpanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={theme.textSecondary}
          accessible={false}
        />
      </Pressable>
      {ingredientsExpanded && (
        <View style={styles.expandContent}>
          {recipe.ingredients.map((ing, i) => (
            <ThemedText
              key={`${ing.name}-${i}`}
              type="body"
              style={styles.ingredientRow}
            >
              {ing.quantity} {ing.unit} {ing.name}
            </ThemedText>
          ))}
        </View>
      )}

      {/* Expandable Instructions */}
      <Pressable
        onPress={toggleInstructions}
        style={[
          styles.expandHeader,
          { borderTopColor: withOpacity(theme.text, 0.06) },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Instructions, ${recipe.instructions.length} steps`}
        accessibilityState={{ expanded: instructionsExpanded }}
      >
        <View style={styles.expandHeaderLeft}>
          <Feather
            name="file-text"
            size={16}
            color={theme.textSecondary}
            accessible={false}
          />
          <ThemedText type="body" style={{ marginLeft: Spacing.sm }}>
            Instructions ({recipe.instructions.length})
          </ThemedText>
        </View>
        <Feather
          name={instructionsExpanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={theme.textSecondary}
          accessible={false}
        />
      </Pressable>
      {instructionsExpanded && (
        <View style={styles.expandContent}>
          {recipe.instructions.map((step, i) => (
            <View key={`step-${i}`} style={styles.stepRow}>
              <ThemedText
                type="caption"
                style={[styles.stepNumber, { color: theme.link }]}
              >
                {i + 1}
              </ThemedText>
              <ThemedText type="body" style={styles.stepText}>
                {step}
              </ThemedText>
            </View>
          ))}
        </View>
      )}

      {/* Diet Tags */}
      {recipe.dietTags && recipe.dietTags.length > 0 && (
        <View style={styles.tagsSection}>
          <RecipeDietTags tags={recipe.dietTags} />
        </View>
      )}

      {/* Allergen Warning */}
      {allergenWarning ? (
        <View
          style={[
            styles.allergenBanner,
            { backgroundColor: withOpacity(theme.error, 0.08) },
          ]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Feather
            name="alert-triangle"
            size={16}
            color={theme.error}
            accessible={false}
          />
          <ThemedText
            type="caption"
            style={{ color: theme.error, flex: 1, marginLeft: Spacing.sm }}
          >
            {allergenWarning}
          </ThemedText>
        </View>
      ) : null}

      {/* Save Button */}
      {onSave && (
        <Pressable
          onPress={handleSave}
          disabled={isSaved || isSaving}
          style={[
            styles.saveButton,
            isSaved
              ? { backgroundColor: theme.link }
              : {
                  borderColor: theme.link,
                  borderWidth: 1.5,
                  backgroundColor: "transparent",
                },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            isSaved ? `${recipe.title} saved` : `Save ${recipe.title} recipe`
          }
          accessibilityState={{ disabled: isSaved || isSaving }}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.link} />
          ) : (
            <Feather
              name={isSaved ? "check" : "bookmark"}
              size={16}
              color={isSaved ? theme.buttonText : theme.link}
            />
          )}
          <ThemedText
            type="body"
            style={{
              color: isSaved ? theme.buttonText : theme.link,
              marginLeft: Spacing.xs,
              fontWeight: "600",
            }}
          >
            {isSaving ? "Saving..." : isSaved ? "Saved" : "Save Recipe"}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

export const RecipeCard = React.memo(RecipeCardInner);

// Announce allergen warning for iOS VoiceOver
export function announceAllergenWarning(warning: string): void {
  if (Platform.OS === "ios") {
    AccessibilityInfo.announceForAccessibility(`Allergen warning: ${warning}`);
  }
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: Spacing.sm,
  },
  imageContainer: {
    width: "100%",
    height: IMAGE_HEIGHT,
  },
  image: {
    width: "100%",
    height: IMAGE_HEIGHT,
    borderTopLeftRadius: BorderRadius.card,
    borderTopRightRadius: BorderRadius.card,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  headerText: {
    flex: 1,
  },
  expandHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  expandHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  expandContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  ingredientRow: {
    paddingVertical: 3,
  },
  stepRow: {
    flexDirection: "row",
    paddingVertical: 4,
  },
  stepNumber: {
    width: 24,
    fontWeight: "700",
  },
  stepText: {
    flex: 1,
  },
  tagsSection: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  allergenBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.button,
    minHeight: 44,
  },
});
