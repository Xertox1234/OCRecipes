import React from "react";
import { StyleSheet, View, Image, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  withOpacity,
  FontFamily,
} from "@/constants/theme";
import type { CommunityRecipe } from "@shared/schema";

interface RecipeCardProps {
  recipe: CommunityRecipe;
  index?: number;
  onPress?: (recipe: CommunityRecipe) => void;
}

export function RecipeCard({ recipe, index = 0, onPress }: RecipeCardProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const haptics = useHaptics();

  const handlePress = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(recipe);
  };

  // Use staggered animation for list items
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(index * 100).duration(300);

  // Purple accent for tags (matching Figma design)
  const tagColor = "#9372F1";
  const tagBgColor = withOpacity(tagColor, 0.12);

  return (
    <Animated.View entering={enteringAnimation}>
      <Card elevation={2} style={styles.card}>
        <Pressable
          onPress={handlePress}
          accessibilityLabel={`${recipe.title}. ${recipe.difficulty} difficulty. ${recipe.timeEstimate}. ${recipe.description}`}
          accessibilityRole="button"
          accessibilityHint="Tap to view full recipe"
        >
          {/* Recipe Image */}
          {recipe.imageUrl ? (
            <Image source={{ uri: recipe.imageUrl }} style={styles.image} />
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

          {/* Content */}
          <View style={styles.content}>
            {/* Tags Row */}
            <View style={styles.tagsRow}>
              {recipe.difficulty && (
                <View style={[styles.tag, { backgroundColor: tagBgColor }]}>
                  <ThemedText type="caption" style={{ color: tagColor }}>
                    {recipe.difficulty}
                  </ThemedText>
                </View>
              )}
              {recipe.timeEstimate && (
                <View style={[styles.tag, { backgroundColor: tagBgColor }]}>
                  <Feather
                    name="clock"
                    size={10}
                    color={tagColor}
                    style={styles.tagIcon}
                  />
                  <ThemedText type="caption" style={{ color: tagColor }}>
                    {recipe.timeEstimate}
                  </ThemedText>
                </View>
              )}
              {recipe.dietTags?.slice(0, 2).map((tag, i) => (
                <View
                  key={i}
                  style={[styles.tag, { backgroundColor: tagBgColor }]}
                >
                  <ThemedText type="caption" style={{ color: tagColor }}>
                    {tag}
                  </ThemedText>
                </View>
              ))}
            </View>

            {/* Title */}
            <ThemedText type="body" style={styles.title} numberOfLines={2}>
              {recipe.title}
            </ThemedText>

            {/* Description */}
            {recipe.description && (
              <ThemedText
                type="caption"
                style={[styles.description, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {recipe.description}
              </ThemedText>
            )}

            {/* Footer */}
            <View style={styles.footer}>
              <View style={styles.authorRow}>
                <Feather
                  name="user"
                  size={12}
                  color={theme.textSecondary}
                  style={styles.authorIcon}
                />
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  Community Recipe
                </ThemedText>
              </View>
              {recipe.servings && (
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  {recipe.servings} servings
                </ThemedText>
              )}
            </View>
          </View>
        </Pressable>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.card,
    overflow: "hidden",
    padding: 0,
  },
  image: {
    width: "100%",
    height: 160,
    resizeMode: "cover",
  },
  imagePlaceholder: {
    width: "100%",
    height: 160,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: Spacing.lg,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  tagIcon: {
    marginRight: 4,
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: Spacing.md,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  authorIcon: {
    marginRight: Spacing.xs,
  },
});
