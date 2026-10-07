import React, { useEffect, useRef } from "react";
import { StyleSheet, Pressable, ViewStyle, StyleProp } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { usePressScale } from "@/hooks/usePressScale";
import { useTheme } from "@/hooks/useTheme";
import { chipSelectTimingConfig } from "@/constants/animations";
import {
  BorderRadius,
  Spacing,
  FontFamily,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";

type ChipVariant = "outline" | "filled" | "tab" | "filter";

interface ChipProps {
  /** Chip label text */
  label: string;
  /** Visual variant */
  variant?: ChipVariant;
  /**
   * Whether the chip is selected/active. Passing it (even `false`) makes the
   * chip selectable: a press ticks the `selection()` haptic before `onPress`,
   * so callers must not buzz themselves. Omit it for action chips.
   */
  selected?: boolean;
  /** Press handler */
  onPress?: () => void;
  /** Custom styles */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label */
  accessibilityLabel?: string;
  /** Override the default accessibility role (defaults to "button") */
  accessibilityRole?: "button" | "tab" | "radio";
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedThemedText = Animated.createAnimatedComponent(ThemedText);

export function Chip({
  label,
  variant = "outline",
  selected: selectedProp,
  onPress,
  style,
  accessibilityLabel,
  accessibilityRole,
}: ChipProps) {
  const selected = selectedProp ?? false;
  const selectable = selectedProp !== undefined;
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const {
    animatedStyle,
    onPressIn: handlePressIn,
    onPressOut: handlePressOut,
  } = usePressScale(0.95, { enabled: !!onPress });

  // Variant-specific styles for either end of the selected fade
  const getVariantStyles = (selected: boolean) => {
    if (variant === "tab") {
      return {
        backgroundColor: selected
          ? theme.accentSolid
          : withOpacity(theme.text, 0.06),
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
      // Alpha-0 link rather than "transparent" so the fade keeps its hue.
      backgroundColor: withOpacity(theme.link, selected ? 0.06 : 0),
      borderWidth: 1,
      borderColor: theme.link,
      textColor: selected ? theme.link : theme.text,
    };
  };

  const variantStyles = getVariantStyles(selected);
  const off = getVariantStyles(false);
  const on = getVariantStyles(true);

  // Starts at the current state so a chip never fades in on mount.
  const selectProgress = useSharedValue(selected ? 1 : 0);
  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    if (prevSelectedRef.current === selected) return;
    prevSelectedRef.current = selected;
    selectProgress.value = withTiming(selected ? 1 : 0, {
      ...chipSelectTimingConfig,
      duration: reducedMotion ? 0 : chipSelectTimingConfig.duration,
    });
  }, [selected, reducedMotion, selectProgress]);

  const animatedChipStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      selectProgress.value,
      [0, 1],
      [off.backgroundColor, on.backgroundColor],
    ),
    borderColor: interpolateColor(
      selectProgress.value,
      [0, 1],
      [off.borderColor, on.borderColor],
    ),
  }));
  // Text fades with the background — the tab variant swaps to white text on
  // the accent fill, which would flash white-on-pale if it snapped.
  const animatedTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      selectProgress.value,
      [0, 1],
      [off.textColor, on.textColor],
    ),
  }));

  const handlePress = () => {
    if (selectable) haptics.selection();
    onPress?.();
  };

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
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole={
          accessibilityRole ?? (variant === "tab" ? "tab" : "button")
        }
        accessibilityLabel={accessibilityLabel || label}
        accessibilityState={{ selected }}
        style={[chipStyles, animatedChipStyle, animatedStyle]}
      >
        <AnimatedThemedText
          maxScale={MAX_FONT_SCALE_CONSTRAINED}
          style={[textStyles, animatedTextStyle]}
        >
          {label}
        </AnimatedThemedText>
      </AnimatedPressable>
    );
  }

  // A selectable chip shown without `onPress` (e.g. an old, inert finder
  // card) still tells a screen reader which option was picked. No toggle
  // role: a role here would promise a gesture that does nothing.
  const staticA11y = selectable
    ? {
        accessible: true,
        accessibilityLabel: accessibilityLabel || label,
        accessibilityState: { selected, disabled: true },
      }
    : {};

  return (
    <Animated.View style={chipStyles} {...staticA11y}>
      <ThemedText maxScale={MAX_FONT_SCALE_CONSTRAINED} style={textStyles}>
        {label}
      </ThemedText>
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
