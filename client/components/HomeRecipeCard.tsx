import React, { useCallback } from "react";
import { StyleSheet, View, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { resolveImageUrl } from "@/lib/query-client";
import type { CommunityRecipe } from "@shared/schema";

const IMAGE_HEIGHT = 160;
const MAX_ANIMATED_INDEX = 10;

interface HomeRecipeCardProps {
  recipe: CommunityRecipe;
  index?: number;
  onPress: (id: number) => void;
}

export const HomeRecipeCard = React.memo(function HomeRecipeCard({
  recipe,
  index = 0,
  onPress,
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
        accessibilityLabel={`${recipe.title}. ${recipe.difficulty ? `Difficulty: ${recipe.difficulty}.` : ""} Tap to view recipe.`}
        accessibilityHint="Opens recipe details"
      >
        {/* Image section */}
        <View style={styles.imageContainer}>
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.imagePlaceholder,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <Feather name="image" size={40} color={theme.textSecondary} />
            </View>
          )}

          {/* Difficulty badge */}
          {recipe.difficulty ? (
            <View style={styles.difficultyBadge}>
              <ThemedText style={styles.difficultyText}>
                {recipe.difficulty}
              </ThemedText>
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
    backgroundColor: "#9372F1", // hardcoded — accent purple for badge visibility
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
