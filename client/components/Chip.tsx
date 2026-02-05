import React from "react";
import { StyleSheet, Pressable, ViewStyle, StyleProp } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, FontFamily } from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
import { withOpacity } from "@/lib/colors";

type ChipVariant = "outline" | "filled";

interface ChipProps {
  /** Chip label text */
  label: string;
  /** Visual variant */
  variant?: ChipVariant;
  /** Whether the chip is selected/active */
  selected?: boolean;
  /** Press handler */
  onPress?: () => void;
  /** Custom styles */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label */
  accessibilityLabel?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Chip({
  label,
  variant = "outline",
  selected = false,
  onPress,
  style,
  accessibilityLabel,
}: ChipProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!reducedMotion && onPress) {
      scale.value = withSpring(0.95, pressSpringConfig);
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion && onPress) {
      scale.value = withSpring(1, pressSpringConfig);
    }
  };

  // Variant-specific styles
  const getVariantStyles = () => {
    if (variant === "filled") {
      return {
        backgroundColor: selected
          ? withOpacity(theme.link, 19) // ~19% opacity when selected
          : withOpacity(theme.link, 8), // ~8% opacity
        borderWidth: 0,
        borderColor: "transparent",
        textColor: theme.link,
      };
    }

    // Outline variant
    return {
      backgroundColor: selected ? withOpacity(theme.link, 6) : "transparent",
      borderWidth: 1,
      borderColor: theme.link,
      textColor: selected ? theme.link : theme.text,
    };
  };

  const variantStyles = getVariantStyles();

  const chipStyles = [
    styles.chip,
    variant === "filled" ? styles.chipFilled : styles.chipOutline,
    {
      backgroundColor: variantStyles.backgroundColor,
      borderWidth: variantStyles.borderWidth,
      borderColor: variantStyles.borderColor,
    },
    style,
  ];

  const textStyles = [
    variant === "filled" ? styles.textFilled : styles.textOutline,
    { color: variantStyles.textColor },
  ];

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityState={{ selected }}
        style={[chipStyles, animatedStyle]}
      >
        <ThemedText style={textStyles}>{label}</ThemedText>
      </AnimatedPressable>
    );
  }

  return (
    <Animated.View style={chipStyles}>
      <ThemedText style={textStyles}>{label}</ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    justifyContent: "center",
  },
  chipOutline: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  chipFilled: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chipFilled,
  },
  textOutline: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    lineHeight: 20,
  },
  textFilled: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
});
