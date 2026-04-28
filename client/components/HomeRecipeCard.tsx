import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import { resolveImageUrl } from "@/lib/query-client";
import type { CommunityRecipe } from "@shared/schema";

const IMAGE_HEIGHT = 160;
const MAX_ANIMATED_INDEX = 10;

interface HomeRecipeCardProps {
  recipe: CommunityRecipe;
  index?: number;
  onPress: (id: number) => void;
  /** When true, shows a small allergen warning indicator on the card. */
  hasAllergenWarning?: boolean;
}

export const HomeRecipeCard = React.memo(function HomeRecipeCard({
  recipe,
  index = 0,
  onPress,
  hasAllergenWarning = false,
}: HomeRecipeCardProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  const handlePress = useCallback(
    () => onPress(recipe.id),
    [onPress, recipe.id],
  );
  const imageUri = resolveImageUrl(recipe.imageUrl);

  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(Math.min(index, MAX_ANIMATED_INDEX) * 80).duration(400);

  return (
    <Animated.View entering={enteringAnimation} style={styles.wrapper}>
      <Card
        elevation={2}
        onPress={handlePress}
        accessibilityLabel={`${recipe.title}. ${recipe.remixedFromId != null ? "Remixed recipe. " : ""}${hasAllergenWarning ? "Contains your allergens. " : ""}${recipe.difficulty ? `Difficulty: ${recipe.difficulty}. ` : ""}Tap to view recipe.`}
        accessibilityHint="Opens recipe details"
      >
        {/* Image section */}
        <View style={styles.imageContainer}>
          <FallbackImage
            source={{ uri: imageUri ?? undefined }}
            style={styles.image}
            fallbackStyle={{
              backgroundColor: theme.backgroundSecondary,
            }}
            fallbackIcon="image"
            fallbackIconSize={40}
            resizeMode="cover"
            accessible={false}
            accessibilityLabel={`Photo of ${recipe.title}`}
          />

          {/* Difficulty badge */}
          {recipe.difficulty ? (
            <View
              style={[styles.difficultyBadge, { backgroundColor: theme.link }]}
            >
              <ThemedText
                maxScale={MAX_FONT_SCALE_CONSTRAINED}
                style={styles.difficultyText}
              >
                {recipe.difficulty}
              </ThemedText>
            </View>
          ) : null}

          {/* Allergen warning dot */}
          {hasAllergenWarning ? (
            <View
              style={[
                styles.allergenDot,
                { backgroundColor: withOpacity(theme.error, 0.9) },
              ]}
              accessibilityLabel="Contains your allergens"
              accessibilityRole="text"
            >
              <Feather
                name="alert-triangle"
                size={10}
                color="#FFFFFF" // hardcoded — always white on colored dot
                accessible={false}
              />
            </View>
          ) : null}

          {/* Remix badge */}
          {recipe.remixedFromId != null ? (
            <View
              style={[
                styles.remixBadge,
                { backgroundColor: withOpacity(theme.link, 0.9) },
              ]}
              accessible={false}
            >
              <Ionicons
                name="shuffle-outline"
                size={10}
                color="#FFFFFF" // hardcoded — always white on colored badge
                accessible={false}
              />
            </View>
          ) : null}
        </View>

        {/* Content section */}
        <View style={styles.content}>
          <View style={styles.authorRow}>
            <Feather name="user" size={12} color={theme.textSecondary} />
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}
            >
              Community Recipe
            </ThemedText>
          </View>
          <ThemedText type="body" style={styles.title} numberOfLines={2}>
            {recipe.title}
          </ThemedText>
          {recipe.description ? (
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary }}
              numberOfLines={2}
            >
              {recipe.description}
            </ThemedText>
          ) : null}
        </View>
      </Card>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  imageContainer: {
    position: "relative",
  },
  image: {
    width: "100%",
    height: IMAGE_HEIGHT,
    borderTopLeftRadius: BorderRadius.card,
    borderTopRightRadius: BorderRadius.card,
  },
  imagePlaceholder: {
    width: "100%",
    height: IMAGE_HEIGHT,
    borderTopLeftRadius: BorderRadius.card,
    borderTopRightRadius: BorderRadius.card,
    justifyContent: "center",
    alignItems: "center",
  },
  difficultyBadge: {
    position: "absolute",
    bottom: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: "transparent", // overridden dynamically with theme.link
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  difficultyText: {
    color: "#FFFFFF", // hardcoded — always white on purple badge
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
    textTransform: "capitalize",
  },
  allergenDot: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  remixBadge: {
    position: "absolute",
    top: Spacing.sm,
    left: Spacing.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: Spacing.lg,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: 16,
    marginBottom: Spacing.xs,
  },
});
