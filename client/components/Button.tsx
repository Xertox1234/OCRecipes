import React, { ReactNode } from "react";
import {
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
  ActivityIndicator,
} from "react-native";
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

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";

interface ButtonProps {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Show a loading spinner and disable interaction */
  loading?: boolean;
  variant?: ButtonVariant;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  onPress,
  children,
  style,
  disabled = false,
  loading = false,
  variant = "primary",
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!reducedMotion && !isDisabled) {
      scale.value = withSpring(0.98, pressSpringConfig);
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion && !isDisabled) {
      scale.value = withSpring(1, pressSpringConfig);
    }
  };

  // Get variant-specific styles
  const getVariantStyles = (): {
    backgroundColor: string;
    textColor: string;
    borderColor?: string;
    borderWidth?: number;
  } => {
    switch (variant) {
      case "primary":
        return {
          backgroundColor: theme.link,
          textColor: theme.buttonText,
        };
      case "secondary":
        return {
          backgroundColor: theme.backgroundSecondary,
          textColor: theme.text,
        };
      case "outline":
        return {
          backgroundColor: "transparent",
          textColor: theme.link,
          borderColor: theme.link,
          borderWidth: 1.5,
        };
      case "ghost":
        return {
          backgroundColor: "transparent",
          textColor: theme.link,
        };
      default:
        return {
          backgroundColor: theme.link,
          textColor: theme.buttonText,
        };
    }
  };

  const variantStyles = getVariantStyles();

  // Derive accessibility label from children if not provided
  const derivedLabel =
    accessibilityLabel || (typeof children === "string" ? children : undefined);

  return (
    <AnimatedPressable
      onPress={isDisabled ? undefined : onPress}
      onPressIn={isDisabled ? undefined : handlePressIn}
      onPressOut={isDisabled ? undefined : handlePressOut}
      disabled={isDisabled}
      accessibilityLabel={derivedLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.button,
        {
          backgroundColor: variantStyles.backgroundColor,
          borderColor: variantStyles.borderColor,
          borderWidth: variantStyles.borderWidth,
          opacity: isDisabled ? 0.5 : 1,
        },
        style,
        animatedStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles.textColor} size="small" />
      ) : (
        <ThemedText
          type="body"
          style={[styles.buttonText, { color: variantStyles.textColor }]}
        >
          {children}
        </ThemedText>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.button,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  buttonText: {
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
});
