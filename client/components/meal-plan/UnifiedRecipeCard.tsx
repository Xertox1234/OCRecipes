import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import Animated from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { RecipeAttributeRow } from "@/components/RecipeAttributeRow";
import { toRecipeAttributeA11ySuffix } from "@/components/recipe-attribute-row-utils";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useSuccessPop } from "@/hooks/useSuccessAnimation";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { resolveImageUrl } from "@/lib/query-client";
import type { SearchableRecipe } from "@shared/types/recipe-search";

export const UnifiedRecipeCard = React.memo(function UnifiedRecipeCard({
  item,
  isFavourited,
  onPress,
  onFavourite,
  adding,
  browseOnly,
}: {
  item: SearchableRecipe;
  isFavourited: boolean;
  onPress: (item: SearchableRecipe) => void;
  onFavourite: (recipeId: number, recipeType: "mealPlan" | "community") => void;
  adding: boolean;
  browseOnly: boolean;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { trigger: triggerHeartPop, animatedStyle: heartPopStyle } =
    useSuccessPop(1.4);

  const triggerFavourite = useCallback(() => {
    // The pop fires its own Success haptic — one buzz per favourite.
    if (isFavourited) {
      haptics.impact();
    } else {
      triggerHeartPop();
    }
    const numericId = parseInt(item.id.split(":")[1], 10);
    const recipeType = item.source === "community" ? "community" : "mealPlan";
    onFavourite(numericId, recipeType);
  }, [
    haptics,
    isFavourited,
    triggerHeartPop,
    onFavourite,
    item.id,
    item.source,
  ]);

  const handleFavourite = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation();
      triggerFavourite();
    },
    [triggerFavourite],
  );

  // The card Pressable is accessible by default, which collapses its whole
  // subtree into a single VoiceOver/TalkBack focus stop — the nested
  // favourite Pressable below is never independently reachable. Expose it as
  // an accessibilityAction on the card instead (same pattern as
  // BatchSummaryScreen's BatchItemRow) so the primary "open recipe" label
  // stays the single focus stop while the favourite toggle is still
  // independently activatable via the screen reader's actions/rotor.
  const accessibilityActions = useMemo(
    () => [
      {
        name: "toggleFavourite",
        label: isFavourited ? "Remove from favourites" : "Add to favourites",
      },
    ],
    [isFavourited],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "toggleFavourite") {
        triggerFavourite();
      }
    },
    [triggerFavourite],
  );

  const isCommunity = item.source === "community";

  // Time display
  const timeText = item.totalTimeMinutes
    ? `${item.totalTimeMinutes} min`
    : null;

  // Calories
  const caloriesText = item.caloriesPerServing
    ? `${Math.round(item.caloriesPerServing)} cal`
    : null;

  // Button icon: community always browses, personal depends on mode
  const iconName = isCommunity || browseOnly ? "chevron-right" : "plus";

  const imageUri = resolveImageUrl(item.imageUrl);

  // Source badge label
  const sourceBadgeLabel = isCommunity ? "Community" : "My Recipe";
  const sourceBadgeColor = isCommunity
    ? theme.link
    : (theme.success ?? theme.link);

  // The card Pressable is accessible={true}, which collapses its whole subtree
  // into a single focus stop — the nested RecipeAttributeRow's own labels are
  // never reached by VoiceOver/TalkBack (see the toast-action-button
  // precedent). Fold the checked attributes and the recipe's derived allergens
  // into the card's own label so the safety-critical allergen info still
  // reaches screen-reader users; the visible chips (RecipeAttributeRow below)
  // remain for sighted users.
  const attributeFacts = {
    dietTags: item.dietTags,
    allergens: item.allergens,
    dietConflicts: item.dietConflicts,
    spiceLevel: item.spiceLevel,
    totalTimeMinutes: item.totalTimeMinutes,
  };
  const attributeA11ySuffix = toRecipeAttributeA11ySuffix(attributeFacts);
  const baseA11yLabel =
    isCommunity || browseOnly
      ? `View ${item.title}`
      : `Add ${item.title} to meal plan`;

  return (
    <Pressable
      onPress={() => onPress(item)}
      disabled={adding}
      style={({ pressed }) => [
        styles.recipeCard,
        { backgroundColor: withOpacity(theme.text, 0.04) },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: adding }}
      accessibilityLabel={`${baseA11yLabel}${attributeA11ySuffix}`}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
    >
      <FallbackImage
        source={{ uri: imageUri ?? undefined }}
        style={styles.recipeCardThumbnail}
        fallbackStyle={{ backgroundColor: withOpacity(theme.text, 0.08) }}
        fallbackIcon="image"
        fallbackIconSize={20}
        accessible={false}
      />
      <View style={styles.recipeCardContent}>
        <ThemedText style={styles.recipeCardTitle} numberOfLines={2}>
          {item.title}
        </ThemedText>
        <RecipeAttributeRow facts={attributeFacts} />
        <View style={styles.recipeCardMeta}>
          {timeText && (
            <>
              <Feather name="clock" size={12} color={theme.textSecondary} />
              <ThemedText
                style={[
                  styles.recipeCardMetaText,
                  { color: theme.textSecondary },
                ]}
              >
                {timeText}
              </ThemedText>
            </>
          )}
          {caloriesText && (
            <ThemedText
              style={[
                styles.recipeCardMetaText,
                {
                  color: theme.textSecondary,
                  marginLeft: timeText ? Spacing.sm : 0,
                },
              ]}
            >
              {caloriesText}
            </ThemedText>
          )}
          <View
            style={[
              styles.sourceBadge,
              {
                backgroundColor: withOpacity(sourceBadgeColor, 0.12),
                marginLeft: timeText || caloriesText ? Spacing.sm : 0,
              },
            ]}
          >
            <ThemedText
              style={[styles.sourceBadgeText, { color: sourceBadgeColor }]}
            >
              {sourceBadgeLabel}
            </ThemedText>
          </View>
        </View>
      </View>
      <Pressable
        onPress={handleFavourite}
        accessibilityRole="button"
        accessibilityLabel={
          isFavourited ? "Remove from favourites" : "Add to favourites"
        }
        style={({ pressed }) => [
          {
            width: 44,
            height: 44,
            justifyContent: "center",
            alignItems: "center",
            marginRight: Spacing.sm,
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Animated.View style={heartPopStyle}>
          <Ionicons
            name={isFavourited ? "heart" : "heart-outline"}
            size={20}
            color={isFavourited ? theme.error : theme.textSecondary}
          />
        </Animated.View>
      </Pressable>
      <View style={[styles.addButton, { backgroundColor: theme.accentSolid }]}>
        {adding ? (
          <ActivityIndicator size="small" color={theme.buttonText} />
        ) : (
          <Feather name={iconName} size={18} color={theme.buttonText} />
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  recipeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
  },
  recipeCardThumbnail: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  recipeCardContent: {
    flex: 1,
    marginRight: Spacing.md,
  },
  recipeCardTitle: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
    marginBottom: 2,
  },
  recipeCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    flexWrap: "wrap",
  },
  recipeCardMetaText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  sourceBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
    alignSelf: "flex-start",
  },
  sourceBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.medium,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
