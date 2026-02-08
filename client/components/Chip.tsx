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
import {
  BorderRadius,
  Spacing,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";

type ChipVariant = "outline" | "filled" | "tab" | "filter";

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
  /** Override the default accessibility role (defaults to "button") */
  accessibilityRole?: "button" | "tab";
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
    if (variant === "tab") {
      return {
        backgroundColor: selected ? theme.link : withOpacity(theme.text, 0.06),
        borderWidth: 0,
        borderColor: "transparent",
        textColor: selected ? theme.buttonText : theme.text,
      };
    }

    if (variant === "filter") {
      return {
        backgroundColor: selected
          ? withOpacity(theme.link, 0.15)
          : withOpacity(theme.text, 0.04),
        borderWidth: 1,
        borderColor: selected ? theme.link : withOpacity(theme.text, 0.1),
        textColor: selected ? theme.link : theme.textSecondary,
      };
    }

    if (variant === "filled") {
      return {
        backgroundColor: selected
          ? withOpacity(theme.link, 0.19) // ~19% opacity when selected
          : withOpacity(theme.link, 0.08), // ~8% opacity
        borderWidth: 0,
        borderColor: "transparent",
        textColor: theme.link,
      };
    }

    // Outline variant
    return {
      backgroundColor: selected ? withOpacity(theme.link, 0.06) : "transparent",
      borderWidth: 1,
      borderColor: theme.link,
      textColor: selected ? theme.link : theme.text,
    };
  };

  const variantStyles = getVariantStyles();

  const getChipSizeStyle = () => {
    if (variant === "filled") return styles.chipFilled;
    if (variant === "tab") return styles.chipTab;
    if (variant === "filter") return styles.chipFilter;
    return styles.chipOutline;
  };

  const getTextSizeStyle = () => {
    if (variant === "filled") return styles.textFilled;
    if (variant === "tab") return styles.textTab;
    if (variant === "filter") return styles.textFilter;
    return styles.textOutline;
  };

  const chipStyles = [
    styles.chip,
    getChipSizeStyle(),
    {
      backgroundColor: variantStyles.backgroundColor,
      borderWidth: variantStyles.borderWidth,
      borderColor: variantStyles.borderColor,
    },
    style,
  ];

  const textStyles = [getTextSizeStyle(), { color: variantStyles.textColor }];

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole={variant === "tab" ? "tab" : "button"}
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
  chipTab: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
  },
  chipFilter: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  textOutline: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    lineHeight: 20,
  },
  textFilled: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  textTab: {
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
  },
  textFilter: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
  },
});
