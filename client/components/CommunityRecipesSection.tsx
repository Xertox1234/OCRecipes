import React, { useState, useCallback } from "react";
import { StyleSheet, View, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { RecipeCard } from "@/components/RecipeCard";
import { RecipeGenerationModal } from "@/components/RecipeGenerationModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumContext } from "@/context/PremiumContext";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import type { CommunityRecipe } from "@shared/schema";

interface CommunityRecipesSectionProps {
  productName: string;
  barcode?: string | null;
  itemId: number;
}

interface GenerationStatus {
  generationsToday: number;
  dailyLimit: number;
  canGenerate: boolean;
}

export function CommunityRecipesSection({
  productName,
  barcode,
  itemId,
}: CommunityRecipesSectionProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { isPremium, features } = usePremiumContext();
  const [showGenerationModal, setShowGenerationModal] = useState(false);

  // Fetch community recipes for this product
  const {
    data: recipes = [],
    isLoading,
    error,
    refetch,
  } = useQuery<CommunityRecipe[]>({
    queryKey: ["/api/recipes/community", barcode, productName],
    queryFn: async () => {
      const params = new URLSearchParams({ productName });
      if (barcode) params.append("barcode", barcode);
      const response = await apiRequest(
        "GET",
        `/api/recipes/community?${params.toString()}`,
      );
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch generation status for premium users
  const { data: generationStatus, refetch: refetchStatus } =
    useQuery<GenerationStatus>({
      queryKey: ["/api/recipes/generation-status"],
      enabled: isPremium && features.recipeGeneration,
      staleTime: 30 * 1000, // 30 seconds
    });

  const handleGeneratePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    setShowGenerationModal(true);
  }, [haptics]);

  const handleGenerationComplete = useCallback(
    (_recipe: CommunityRecipe) => {
      setShowGenerationModal(false);
      // Refetch recipes and generation status
      refetch();
      refetchStatus();
    },
    [refetch, refetchStatus],
  );

  const handleRecipePress = useCallback((_recipe: CommunityRecipe) => {
    // Could navigate to a recipe detail view in the future
  }, []);

  const canGenerate = generationStatus?.canGenerate ?? false;
  const remainingGenerations = generationStatus
    ? generationStatus.dailyLimit - generationStatus.generationsToday
    : 0;

  // Purple accent colors
  const accentColor = "#9372F1";
  const accentBg = withOpacity(accentColor, 0.12);

  return (
    <View style={styles.container}>
      {/* Header with Generate Button */}
      <View style={styles.header}>
        <ThemedText type="h4" style={styles.title}>
          Community Recipes
        </ThemedText>
        {isPremium && features.recipeGeneration && (
          <Pressable
            onPress={handleGeneratePress}
            disabled={!canGenerate}
            style={[
              styles.generateButton,
              {
                backgroundColor: canGenerate
                  ? accentBg
                  : theme.backgroundTertiary,
              },
            ]}
            accessibilityLabel={
              canGenerate
                ? `Generate a new recipe. ${remainingGenerations} generations remaining today.`
                : "Daily recipe generation limit reached"
            }
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather
              name="plus"
              size={14}
              color={canGenerate ? accentColor : theme.textSecondary}
            />
            <ThemedText
              type="caption"
              style={{
                color: canGenerate ? accentColor : theme.textSecondary,
                marginLeft: Spacing.xs,
              }}
            >
              Generate ({remainingGenerations})
            </ThemedText>
          </Pressable>
        )}
      </View>

      {/* Loading State */}
      {isLoading && (
        <Card elevation={1} style={styles.loadingCard}>
          <ActivityIndicator size="small" color={theme.success} />
          <ThemedText
            type="body"
            style={{ color: theme.textSecondary, marginTop: Spacing.md }}
          >
            Finding recipes...
          </ThemedText>
        </Card>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Card elevation={1} style={styles.errorCard}>
          <Feather name="cloud-off" size={24} color={theme.textSecondary} />
          <ThemedText
            type="body"
            style={{ color: theme.textSecondary, marginTop: Spacing.sm }}
          >
            Unable to load recipes
          </ThemedText>
          <Pressable
            onPress={() => refetch()}
            style={styles.retryButton}
            accessibilityLabel="Retry loading recipes"
            accessibilityRole="button"
          >
            <Feather name="refresh-cw" size={14} color={accentColor} />
            <ThemedText
              type="caption"
              style={{ color: accentColor, marginLeft: Spacing.xs }}
            >
              Retry
            </ThemedText>
          </Pressable>
        </Card>
      )}

      {/* Recipe List */}
      {!isLoading && !error && recipes.length > 0 && (
        <View style={styles.recipeList}>
          {recipes.map((recipe, index) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              index={index}
              onPress={handleRecipePress}
            />
          ))}
        </View>
      )}

      {/* Empty State */}
      {!isLoading && !error && recipes.length === 0 && (
        <Card elevation={1} style={styles.emptyCard}>
          <View
            style={[
              styles.emptyIcon,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <Feather name="book-open" size={32} color={theme.textSecondary} />
          </View>
          <ThemedText
            type="body"
            style={[styles.emptyTitle, { color: theme.text }]}
          >
            No recipes yet
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, textAlign: "center" }}
          >
            {isPremium && features.recipeGeneration
              ? "Be the first to create a recipe for this product!"
              : "Premium users can generate custom recipes for any product."}
          </ThemedText>
          {isPremium && features.recipeGeneration && canGenerate && (
            <Pressable
              onPress={handleGeneratePress}
              style={[
                styles.emptyGenerateButton,
                { backgroundColor: accentColor },
              ]}
              accessibilityLabel="Generate a recipe"
              accessibilityRole="button"
            >
              <Feather name="plus" size={16} color="#FFFFFF" />
              <ThemedText
                type="small"
                style={{
                  color: "#FFFFFF",
                  marginLeft: Spacing.xs,
                  fontWeight: "600",
                }}
              >
                Create Recipe
              </ThemedText>
            </Pressable>
          )}
          {!isPremium && (
            <View style={[styles.upgradeBadge, { backgroundColor: accentBg }]}>
              <Feather name="star" size={14} color={accentColor} />
              <ThemedText
                type="caption"
                style={{ color: accentColor, marginLeft: Spacing.xs }}
              >
                Upgrade to Premium
              </ThemedText>
            </View>
          )}
        </Card>
      )}

      {/* Generation Modal */}
      <RecipeGenerationModal
        visible={showGenerationModal}
        onClose={() => setShowGenerationModal(false)}
        onComplete={handleGenerationComplete}
        productName={productName}
        barcode={barcode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.xl,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  title: {
    fontWeight: "600",
  },
  generateButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
  },
  loadingCard: {
    padding: Spacing["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  errorCard: {
    padding: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
    padding: Spacing.sm,
  },
  recipeList: {
    gap: Spacing.md,
  },
  emptyCard: {
    padding: Spacing["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  emptyGenerateButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.button,
    marginTop: Spacing.lg,
  },
  upgradeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
    marginTop: Spacing.lg,
  },
});
