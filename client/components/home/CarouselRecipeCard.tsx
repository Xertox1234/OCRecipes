import React, { useCallback, useMemo } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  Pressable,
  Dimensions,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { RecipeAttributeRow } from "@/components/RecipeAttributeRow";
import { toRecipeAttributeA11ySuffix } from "@/components/recipe-attribute-row-utils";
import { FallbackImage } from "@/components/FallbackImage";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { useSuccessPop } from "@/hooks/useSuccessAnimation";
import { usePressScale } from "@/hooks/usePressScale";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import { resolveImageUrl } from "@/lib/query-client";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
export const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.85);
const IMAGE_HEIGHT = 140;
// Visible circle; hitSlop below brings the touch target to 44.
const BUTTON_SIZE = 36;

interface CarouselRecipeCardProps {
  card: CarouselCardType;
  isFavourited?: boolean;
  onPress: (card: CarouselCardType) => void;
  onDismiss?: (card: CarouselCardType) => void;
  onFavourite?: (recipeId: number) => void;
  /** When false, hides the favourite/dismiss action row (static preset rows). Default true. */
  showActions?: boolean;
  /** Whether the details (chips, reason, View recipe) are showing. Only used
   * with `onToggleExpand`. */
  expanded?: boolean;
  /** When given, a tap expands or collapses the card and only the
   * "View recipe" button opens the recipe. Omit for a one-tap card. */
  onToggleExpand?: (card: CarouselCardType) => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const CarouselRecipeCard = React.memo(function CarouselRecipeCard({
  card,
  isFavourited = false,
  onPress,
  onDismiss,
  onFavourite,
  showActions = true,
  expanded = false,
  onToggleExpand,
}: CarouselRecipeCardProps) {
  const { theme } = useTheme();
  const { reducedMotion, screenReaderEnabled } = useAccessibility();
  const haptics = useHaptics();
  const { trigger: triggerHeartPop, animatedStyle: heartPopStyle } =
    useSuccessPop(1.4);

  const {
    animatedStyle,
    onPressIn: handlePressIn,
    onPressOut: handlePressOut,
  } = usePressScale(0.97);

  // A screen reader already hears every detail in the card's label, so for
  // its user the card keeps opening the recipe in one activation.
  const expandable = onToggleExpand !== undefined && !screenReaderEnabled;
  const showDetails = !expandable || expanded;

  const handlePress = useCallback(() => {
    if (expandable) {
      onToggleExpand(card);
    } else {
      onPress(card);
    }
  }, [expandable, onToggleExpand, onPress, card]);

  const handleViewRecipe = useCallback(() => onPress(card), [onPress, card]);

  const handleDismiss = useCallback(() => {
    haptics.impact();
    AccessibilityInfo.announceForAccessibility("Recipe dismissed");
    onDismiss?.(card);
  }, [onDismiss, card, haptics]);

  const handleFavourite = useCallback(() => {
    // The pop fires its own Success haptic — one buzz per favourite.
    if (isFavourited) {
      haptics.impact();
    } else {
      triggerHeartPop();
    }
    onFavourite?.(card.id);
  }, [haptics, isFavourited, triggerHeartPop, onFavourite, card.id]);

  // The card AnimatedPressable is accessible by default, which collapses its
  // whole subtree into a single VoiceOver/TalkBack focus stop — the nested
  // favourite and dismiss Pressables below (in the actions row) are never
  // independently reachable. Expose both as accessibilityActions on the card
  // instead (same pattern as RecipeBrowserScreen's UnifiedRecipeCard and
  // BatchSummaryScreen's BatchItemRow) so the primary "open recipe" label
  // stays the single focus stop while the favourite toggle and dismiss are
  // still independently activatable via the screen reader's actions/rotor.
  const accessibilityActions = useMemo(
    () =>
      showActions
        ? [
            {
              name: "toggleFavourite",
              label: isFavourited
                ? "Remove from favourites"
                : "Add to favourites",
            },
            { name: "dismiss", label: "Dismiss recipe" },
          ]
        : undefined,
    [showActions, isFavourited],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "toggleFavourite") {
        handleFavourite();
      } else if (event.nativeEvent.actionName === "dismiss") {
        handleDismiss();
      }
    },
    [handleFavourite, handleDismiss],
  );

  const imageUri = card.imageUrl ? resolveImageUrl(card.imageUrl) : null;
  // Truthy check is deliberate: 0 is not a meaningful prep duration, so it
  // renders like null (no badge, no label segment).
  const prepLabel = card.prepTimeMinutes ? `${card.prepTimeMinutes} min` : null;

  // The card AnimatedPressable is accessible by default, which collapses its
  // whole subtree into a single VoiceOver/TalkBack focus stop — the nested
  // RecipeAttributeRow's own labels are never reached. Fold the checked
  // attributes and the recipe's derived allergens into the card's own label
  // so the safety-critical allergen info still reaches screen-reader users
  // (same pattern as RecipeBrowserScreen's UnifiedRecipeCard); the visible
  // chips (RecipeAttributeRow below) remain for sighted users.
  const attributeFacts = {
    dietTags: card.dietTags,
    allergens: card.allergens,
    dietConflicts: card.dietConflicts,
    spiceLevel: card.spiceLevel,
    totalTimeMinutes: card.totalTimeMinutes,
  };
  const attributeA11ySuffix = toRecipeAttributeA11ySuffix(attributeFacts);

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[animatedStyle, styles.cardWrapper]}
      accessibilityRole="button"
      accessibilityLabel={`${card.isRemix ? "Remixed recipe. " : ""}${card.isCanonical ? "Curated recipe. " : ""}${card.title}${prepLabel ? `, ${prepLabel} prep` : ""}${card.recommendationReason ? `. ${card.recommendationReason}` : ""}${attributeA11ySuffix}. Double tap to view recipe.`}
      accessibilityHint="Opens recipe details"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
    >
      <Animated.View
        exiting={reducedMotion ? undefined : FadeOut.duration(300)}
        layout={reducedMotion ? undefined : LinearTransition.duration(200)}
        style={[
          styles.card,
          {
            backgroundColor: theme.backgroundSecondary,
            shadowColor: theme.text,
          },
        ]}
      >
        {/* Hero image */}
        <View style={styles.imageContainer}>
          {imageUri ? (
            <FallbackImage
              source={{ uri: imageUri }}
              style={styles.image}
              fallbackStyle={{ backgroundColor: theme.backgroundDefault }}
              fallbackIcon="image"
              fallbackIconSize={36}
              resizeMode="cover"
              accessible={false}
            />
          ) : (
            <View
              style={[
                styles.imageFallback,
                {
                  backgroundColor: withOpacity(theme.link, 0.12),
                },
              ]}
            >
              <Feather
                name="book-open"
                size={36}
                color={withOpacity(theme.link, 0.5)}
              />
            </View>
          )}

          {/* Prep time badge */}
          {prepLabel ? (
            <View style={styles.prepBadge}>
              <Feather
                name="clock"
                size={11}
                color="#FFFFFF" // hardcoded — always white on dark overlay
                accessible={false}
              />
              <ThemedText
                maxScale={MAX_FONT_SCALE_CONSTRAINED}
                style={styles.prepText}
              >
                {prepLabel}
              </ThemedText>
            </View>
          ) : null}

          {/* Remix badge */}
          {card.isRemix ? (
            <View
              style={[
                styles.remixBadge,
                // Near-opaque (0.9) fill under a white icon — accentSolid (not
                // link) so the glyph clears contrast; the one withOpacity exception.
                { backgroundColor: withOpacity(theme.accentSolid, 0.9) },
              ]}
              // Decorative — remix status is announced via the card label prefix
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

          {/* Favourite + dismiss, on the photo */}
          {showActions ? (
            <View style={styles.actions}>
              <Pressable
                onPress={handleFavourite}
                style={styles.actionButton}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={
                  isFavourited ? "Remove from favourites" : "Add to favourites"
                }
              >
                <Animated.View style={heartPopStyle}>
                  <Ionicons
                    name={isFavourited ? "heart" : "heart-outline"}
                    size={18}
                    color="#FFFFFF" // hardcoded — always white on dark overlay
                    accessible={false}
                  />
                </Animated.View>
              </Pressable>
              <Pressable
                onPress={handleDismiss}
                style={styles.actionButton}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel="Dismiss recipe"
              >
                <Feather
                  name="x"
                  size={18}
                  color="#FFFFFF" // hardcoded — always white on dark overlay
                  accessible={false}
                />
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Content */}
        <View style={styles.content}>
          <ThemedText
            type="body"
            style={[styles.title, { color: theme.text }]}
            numberOfLines={2}
          >
            {card.title}
          </ThemedText>

          {showDetails ? (
            <Animated.View
              entering={
                expandable && !reducedMotion ? FadeIn.duration(200) : undefined
              }
              style={styles.details}
            >
              <RecipeAttributeRow facts={attributeFacts} />

              {/* Rendered only when non-empty: an empty `recommendationReason`
                  (see `toCarouselCard`'s fallback chain, which terminates at
                  `recipe.cuisine ?? ""`) would otherwise leave a blank Text
                  that still reserves its `styles.reason` marginBottom — the
                  sighted counterpart of the composed-label double-period bug
                  fixed in PR 711. */}
              {card.recommendationReason ? (
                <ThemedText
                  testID="carousel-card-reason"
                  type="caption"
                  style={[styles.reason, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {card.recommendationReason}
                </ThemedText>
              ) : null}

              {expandable ? (
                <Button onPress={handleViewRecipe} style={styles.viewButton}>
                  View recipe
                </Button>
              ) : null}
            </Animated.View>
          ) : null}
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  cardWrapper: {
    width: CARD_WIDTH,
    marginRight: Spacing.md,
  },
  card: {
    borderRadius: BorderRadius.card,
    overflow: "hidden",
    // Shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  imageContainer: {
    position: "relative",
  },
  image: {
    width: "100%",
    height: IMAGE_HEIGHT,
  },
  imageFallback: {
    width: "100%",
    height: IMAGE_HEIGHT,
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
  prepBadge: {
    position: "absolute",
    bottom: Spacing.sm,
    left: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
    gap: 4,
  },
  prepText: {
    color: "#FFFFFF", // hardcoded — always white on dark overlay
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
  },
  content: {
    padding: Spacing.md,
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
    marginBottom: 2,
  },
  details: {
    marginTop: Spacing.sm,
  },
  reason: {
    fontSize: 12,
  },
  viewButton: {
    marginTop: Spacing.md,
    // Hugs its label on the left: the Scan FAB floats over the bottom-right
    // of the Home carousel (QA sweep #35).
    alignSelf: "flex-start",
  },
  actions: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    // Same dark overlay as the prep-time badge so white icons read on any photo.
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
});
