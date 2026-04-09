import React, { useCallback } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  Pressable,
  Dimensions,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  FadeOut,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
import { resolveImageUrl } from "@/lib/query-client";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
export const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.85);
const IMAGE_HEIGHT = 140;
const BUTTON_SIZE = 44;

interface CarouselRecipeCardProps {
  card: CarouselCardType;
  onPress: (card: CarouselCardType) => void;
  onDismiss: (card: CarouselCardType) => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const CarouselRecipeCard = React.memo(function CarouselRecipeCard({
  card,
  onPress,
  onDismiss,
}: CarouselRecipeCardProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const haptics = useHaptics();

  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.97, pressSpringConfig);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, pressSpringConfig);
  }, [scale]);

  const handlePress = useCallback(() => onPress(card), [onPress, card]);

  const handleDismiss = useCallback(() => {
    haptics.impact();
    AccessibilityInfo.announceForAccessibility("Recipe dismissed");
    onDismiss(card);
  }, [onDismiss, card, haptics]);

  const imageUri = card.imageUrl ? resolveImageUrl(card.imageUrl) : null;
  const prepLabel = card.prepTimeMinutes ? `${card.prepTimeMinutes} min` : null;

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[animatedStyle, styles.cardWrapper]}
      accessibilityRole="button"
      accessibilityLabel={`${card.title}${prepLabel ? `, ${prepLabel} prep` : ""}. ${card.recommendationReason}. Double tap to view recipe.`}
      accessibilityHint="Opens recipe details"
    >
      <Animated.View
        exiting={reducedMotion ? undefined : FadeOut.duration(300)}
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
                { backgroundColor: withOpacity(theme.link, 0.9) },
              ]}
              accessibilityLabel="Remixed recipe"
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

        {/* Content */}
        <View style={styles.content}>
          <ThemedText
            type="body"
            style={[styles.title, { color: theme.text }]}
            numberOfLines={2}
          >
            {card.title}
          </ThemedText>

          <ThemedText
            type="caption"
            style={[styles.reason, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {card.recommendationReason}
          </ThemedText>

          {/* Action buttons */}
          <View style={styles.actions}>
            <Pressable
              onPress={handleDismiss}
              style={[
                styles.actionButton,
                { backgroundColor: withOpacity(theme.error, 0.1) },
              ]}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Dismiss recipe"
            >
              <Feather
                name="thumbs-down"
                size={18}
                color={theme.error}
                accessible={false}
              />
            </Pressable>
          </View>
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
  reason: {
    fontSize: 12,
    marginBottom: Spacing.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  actionButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
});
