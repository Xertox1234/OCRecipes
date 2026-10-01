import React from "react";
import {
  StyleSheet,
  Pressable,
  View,
  ViewStyle,
  StyleProp,
  Image,
  ImageSourcePropType,
  type ViewProps,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
import { getBackgroundColorForElevation, getBadgeColors } from "./card-utils";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

interface Badge {
  label: string;
  variant?: BadgeVariant;
}

interface CardProps {
  /** Semantic elevation level (1-3). Controls background color tier, not Android shadow. */
  elevation?: number;
  /** Card title */
  title?: string;
  /** Card description/subtitle */
  description?: string;
  /** Optional header image */
  image?: ImageSourcePropType;
  /** Accessibility label for the header image */
  imageAccessibilityLabel?: string;
  /** Image height (default: 120) */
  imageHeight?: number;
  /** Badges to display on the image */
  badges?: Badge[];
  /** Card content */
  children?: React.ReactNode;
  /** Press handler */
  onPress?: () => void;
  /** Custom styles */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label */
  accessibilityLabel?: string;
  /** Accessibility hint */
  accessibilityHint?: string;
  /**
   * Forwarded to the card's root. Lets a host screen hide this card's
   * subtree from screen readers (e.g. while a `useConfirmationModal` sheet
   * is presented via its `behindContentA11yProps`) without an extra wrapper
   * `View`. No-op on Android (see `importantForAccessibility`).
   */
  accessibilityElementsHidden?: ViewProps["accessibilityElementsHidden"];
  /**
   * Forwarded to the card's root. Android counterpart to
   * `accessibilityElementsHidden` — no-op on iOS.
   */
  importantForAccessibility?: ViewProps["importantForAccessibility"];
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Card({
  elevation = 1,
  title,
  description,
  image,
  imageAccessibilityLabel,
  imageHeight = 120,
  badges,
  children,
  onPress,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityElementsHidden,
  importantForAccessibility,
}: CardProps) {
  const { theme, isDark } = useTheme();
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);

  const cardBackgroundColor = getBackgroundColorForElevation(elevation, theme);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!reducedMotion) {
      scale.value = withSpring(0.98, pressSpringConfig);
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion) {
      scale.value = withSpring(1, pressSpringConfig);
    }
  };

  const shadowStyle = isDark
    ? {}
    : {
        shadowColor: "#000", // hardcoded
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 2,
      };

  const content = (
    <>
      {image ? (
        <View style={styles.imageContainer}>
          <Image
            source={image}
            style={[styles.image, { height: imageHeight }]}
            resizeMode="cover"
            accessible={!!imageAccessibilityLabel}
            accessibilityLabel={imageAccessibilityLabel}
          />
          {badges && badges.length > 0 ? (
            <View style={styles.badgeContainer}>
              {badges.map((badge, index) => {
                const colors = getBadgeColors(
                  badge.variant || "default",
                  theme,
                );
                return (
                  <View
                    key={index}
                    style={[styles.badge, { backgroundColor: colors.bg }]}
                  >
                    <ThemedText
                      type="caption"
                      style={[styles.badgeText, { color: colors.text }]}
                    >
                      {badge.label}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={[styles.contentContainer, !image && styles.contentOnly]}>
        {title ? (
          <ThemedText type="h4" style={styles.cardTitle}>
            {title}
          </ThemedText>
        ) : null}
        {description ? (
          <ThemedText
            type="small"
            style={[styles.cardDescription, { color: theme.textSecondary }]}
          >
            {description}
          </ThemedText>
        ) : null}
        {children}
      </View>
    </>
  );

  const cardStyles = [
    styles.card,
    shadowStyle,
    {
      backgroundColor: cardBackgroundColor,
    },
    style,
  ];

  // Only render as Pressable when onPress is provided
  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityElementsHidden={accessibilityElementsHidden}
        importantForAccessibility={importantForAccessibility}
        style={[cardStyles, animatedStyle]}
      >
        {content}
      </AnimatedPressable>
    );
  }

  return (
    <View
      style={cardStyles}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility={importantForAccessibility}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.card,
    overflow: "hidden",
  },
  imageContainer: {
    position: "relative",
  },
  image: {
    width: "100%",
    borderTopLeftRadius: BorderRadius.card,
    borderTopRightRadius: BorderRadius.card,
  },
  badgeContainer: {
    position: "absolute",
    bottom: Spacing.sm,
    left: Spacing.sm,
    flexDirection: "row",
    gap: Spacing.xs,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  badgeText: {
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  contentContainer: {
    padding: Spacing.lg,
  },
  contentOnly: {
    padding: Spacing.xl,
  },
  cardTitle: {
    marginBottom: Spacing.xs,
  },
  cardDescription: {
    marginBottom: Spacing.sm,
  },
});
