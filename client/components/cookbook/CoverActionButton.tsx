import React from "react";
import { StyleSheet, View, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

interface CoverActionButtonProps {
  icon: FeatherIconName;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Renders the armed/chosen state (create mode's "generate on save" toggle). */
  selected?: boolean;
  /** Shows a lock badge — the action is premium and will open the upgrade sheet. */
  locked?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * One of the two cover actions ("Add photo" / "Generate cover").
 *
 * Hand-rolled rather than using the shared `Button`: that component wraps its
 * children in a `ThemedText`, so it can't host the leading icon or the lock
 * badge these need. The press-spring below is the same `pressSpringConfig`
 * idiom the shared button uses, so the press feel matches the rest of the app.
 */
export function CoverActionButton({
  icon,
  label,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  selected = false,
  locked = false,
  loading = false,
  disabled = false,
}: CoverActionButtonProps) {
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

  const contentColor = selected ? theme.buttonText : theme.link;

  return (
    <AnimatedPressable
      onPress={isDisabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, busy: loading }}
      style={[
        styles.button,
        {
          backgroundColor: selected ? theme.accentSolid : "transparent",
          borderColor: selected
            ? theme.accentSolid
            : withOpacity(theme.link, 0.4),
          opacity: isDisabled ? 0.5 : 1,
        },
        animatedStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <Feather
          name={selected ? "check" : icon}
          size={16}
          color={contentColor}
          accessible={false}
        />
      )}
      <ThemedText
        numberOfLines={1}
        style={[styles.label, { color: contentColor }]}
      >
        {label}
      </ThemedText>
      {locked ? (
        <View
          style={[
            styles.lock,
            { backgroundColor: withOpacity(theme.link, 0.14) },
          ]}
        >
          <Feather
            name="lock"
            size={10}
            color={theme.link}
            accessible={false}
          />
        </View>
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
    flexShrink: 1,
  },
  lock: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
});
