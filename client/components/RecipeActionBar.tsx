import React, { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useIsRecipeFavourited,
  useToggleFavouriteRecipe,
  useShareRecipe,
} from "@/hooks/useFavouriteRecipes";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface RecipeActionBarProps {
  recipeId: number;
  recipeType: "mealPlan" | "community";
  onSaveToCookbook: () => void;
}

export const RecipeActionBar = React.memo(function RecipeActionBar({
  recipeId,
  recipeType,
  onSaveToCookbook,
}: RecipeActionBarProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const isFavourited = useIsRecipeFavourited(recipeId, recipeType);
  const { mutate: toggleFavourite } = useToggleFavouriteRecipe();
  const { share } = useShareRecipe();

  const handleFavourite = useCallback(() => {
    haptics.impact();
    toggleFavourite({ recipeId, recipeType });
  }, [haptics, toggleFavourite, recipeId, recipeType]);

  const handleShare = useCallback(() => {
    haptics.impact();
    share(recipeId, recipeType);
  }, [haptics, share, recipeId, recipeType]);

  const handleSave = useCallback(() => {
    haptics.impact();
    onSaveToCookbook();
  }, [haptics, onSaveToCookbook]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
      accessibilityRole="toolbar"
      accessibilityLabel="Recipe actions"
    >
      <Pressable
        onPress={handleFavourite}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={
          isFavourited ? "Remove from favourites" : "Add to favourites"
        }
        accessibilityState={{ selected: isFavourited }}
      >
        <Ionicons
          name={isFavourited ? "heart" : "heart-outline"}
          size={20}
          color={isFavourited ? theme.error : theme.textSecondary}
        />
        <ThemedText
          style={[
            styles.actionLabel,
            { color: isFavourited ? theme.error : theme.textSecondary },
          ]}
        >
          Favourite
        </ThemedText>
      </Pressable>

      <Pressable
        onPress={handleShare}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Share recipe"
      >
        <Feather name="share" size={18} color={theme.textSecondary} />
        <ThemedText
          style={[styles.actionLabel, { color: theme.textSecondary }]}
        >
          Share
        </ThemedText>
      </Pressable>

      <Pressable
        onPress={handleSave}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Save to cookbook"
      >
        <Feather name="bookmark" size={18} color={theme.textSecondary} />
        <ThemedText
          style={[styles.actionLabel, { color: theme.textSecondary }]}
        >
          Save
        </ThemedText>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    marginTop: Spacing.md,
  },
  action: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
