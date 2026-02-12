import React from "react";
import { StyleSheet, View, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

type ActionConfig = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  isLocked?: boolean;
  isLoading?: boolean;
  accessibilityHint?: string;
};

function ActionButton({
  icon,
  label,
  onPress,
  color,
  isLocked,
  isLoading,
  accessibilityHint,
}: ActionConfig) {
  const { theme } = useTheme();
  const buttonColor = color ?? theme.text;
  const dimmed = isLocked || isLoading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isLoading}
      accessibilityLabel={isLocked ? `${label} (premium feature)` : label}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: withOpacity(buttonColor, 0.08) },
        pressed && { opacity: 0.6 },
        dimmed && { opacity: 0.5 },
      ]}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={buttonColor} />
      ) : (
        <View style={styles.actionIconContainer}>
          <Feather name={icon} size={18} color={buttonColor} />
          {isLocked ? (
            <View
              style={[
                styles.lockBadge,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <Feather name="lock" size={8} color={theme.textSecondary} />
            </View>
          ) : null}
        </View>
      )}
      <ThemedText
        type="caption"
        style={[styles.actionLabel, { color: buttonColor }]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

interface HistoryItemActionsProps {
  isFavourited: boolean;
  isPremium: boolean;
  isFavouriteLoading?: boolean;
  isDiscardLoading?: boolean;
  onFavourite: () => void;
  onGroceryList: () => void;
  onGenerateRecipe: () => void;
  onShare: () => void;
  onDiscard: () => void;
}

export function HistoryItemActions({
  isFavourited,
  isPremium,
  isFavouriteLoading,
  isDiscardLoading,
  onFavourite,
  onGroceryList,
  onGenerateRecipe,
  onShare,
  onDiscard,
}: HistoryItemActionsProps) {
  const { theme } = useTheme();

  return (
    <View
      style={[styles.container, { borderTopColor: theme.border }]}
      accessibilityRole="toolbar"
      accessibilityLabel="Item actions"
    >
      <ActionButton
        icon="heart"
        label={isFavourited ? "Saved" : "Favourite"}
        onPress={onFavourite}
        color={isFavourited ? theme.error : theme.textSecondary}
        isLoading={isFavouriteLoading}
        accessibilityHint={
          isFavourited ? "Remove from favourites" : "Add to favourites"
        }
      />
      <ActionButton
        icon="shopping-cart"
        label="Grocery"
        onPress={onGroceryList}
        color={theme.success}
        accessibilityHint="Add to grocery list"
      />
      <ActionButton
        icon="book-open"
        label="Recipe"
        onPress={onGenerateRecipe}
        color={theme.carbsAccent}
        isLocked={!isPremium}
        accessibilityHint={
          isPremium
            ? "Generate a recipe using this item"
            : "Premium feature. Tap to upgrade."
        }
      />
      <ActionButton
        icon="share-2"
        label="Share"
        onPress={onShare}
        accessibilityHint="Share this item"
      />
      <ActionButton
        icon="trash-2"
        label="Discard"
        onPress={onDiscard}
        color={theme.error}
        isLoading={isDiscardLoading}
        accessibilityHint="Remove from history"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: Spacing.md,
    marginTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    minWidth: 56,
  },
  actionIconContainer: {
    position: "relative",
    marginBottom: Spacing.xs,
  },
  lockBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: "center",
    alignItems: "center",
  },
  actionLabel: {
    fontSize: 10,
    textAlign: "center",
  },
});
