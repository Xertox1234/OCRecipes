import React, { useEffect, useCallback } from "react";
import {
  StyleSheet,
  Pressable,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  SlideInUp,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  Shadows,
  withOpacity,
} from "@/constants/theme";
import {
  toastSpringConfig,
  toastExitTimingConfig,
} from "@/constants/animations";
import { getToastColors, getToastAccessibilityRole } from "./toast-utils";
import type { ToastVariant, ToastAction } from "./toast-utils";
import type { Colors } from "@/constants/theme";

type Theme = (typeof Colors)["light"];

interface ToastProps {
  message: string;
  variant: ToastVariant;
  theme: Theme;
  onDismiss: () => void;
  action?: ToastAction;
}

const AUTO_DISMISS_MS = 3000;
const ACTION_DISMISS_MS = 5000;
const SWIPE_DISMISS_THRESHOLD = -50;

export function Toast({
  message,
  variant,
  theme,
  onDismiss,
  action,
}: ToastProps) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibility();
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);
  const colors = getToastColors(variant, theme);
  const a11yRole = getToastAccessibilityRole(variant);
  const dismissMs = action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS;

  const handleAction = useCallback(() => {
    action?.onPress();
    onDismiss();
  }, [action, onDismiss]);

  useEffect(() => {
    if (Platform.OS === "ios") {
      const announcement = action
        ? `${message}. ${action.label} available.`
        : message;
      AccessibilityInfo.announceForAccessibility(announcement);
    }
  }, [message, action]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (reducedMotion) {
        onDismiss();
      } else {
        opacity.value = withTiming(0, toastExitTimingConfig, (finished) => {
          if (finished) runOnJS(onDismiss)();
        });
      }
    }, dismissMs);
    return () => clearTimeout(timer);
  }, [onDismiss, opacity, reducedMotion, dismissMs]);

  const swipeGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY < 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (e.translationY < SWIPE_DISMISS_THRESHOLD) {
        translateY.value = withTiming(-200, toastExitTimingConfig);
        opacity.value = withTiming(0, toastExitTimingConfig, (finished) => {
          if (finished) runOnJS(onDismiss)();
        });
      } else {
        translateY.value = withSpring(0, toastSpringConfig);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const entering = reducedMotion
    ? undefined
    : SlideInUp.springify().damping(20).stiffness(200);

  return (
    <GestureDetector gesture={swipeGesture}>
      <Animated.View
        entering={entering}
        style={[
          styles.container,
          Shadows.medium,
          animatedStyle,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: colors.background,
          },
        ]}
        accessible
        accessibilityRole={a11yRole}
        accessibilityLabel={message}
        accessibilityLiveRegion="polite"
      >
        <Feather
          name={colors.icon as "check-circle" | "alert-circle" | "info"}
          size={20}
          color={colors.text}
          accessible={false}
        />
        <ThemedText
          type="small"
          style={[styles.message, { color: colors.text }]}
          numberOfLines={2}
        >
          {message}
        </ThemedText>
        {action && (
          <Pressable
            onPress={handleAction}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={8}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: withOpacity(colors.text, 0.2),
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <ThemedText
              type="small"
              style={[styles.actionLabel, { color: colors.text }]}
            >
              {action.label}
            </ThemedText>
          </Pressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    zIndex: 9999,
  },
  message: {
    flex: 1,
    fontFamily: FontFamily.medium,
  },
  actionButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
    minHeight: 32,
    justifyContent: "center",
  },
  actionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
  },
});
