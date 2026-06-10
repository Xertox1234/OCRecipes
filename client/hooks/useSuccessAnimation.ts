import { useCallback, useEffect } from "react";
import {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
  type SharedValue,
  type AnimatedStyle,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { useAccessibility } from "@/hooks/useAccessibility";
import { successPopConfig } from "@/constants/animations";
import type { ViewStyle } from "react-native";

/**
 * Reusable success animation hooks.
 *
 * Each returns a `trigger()` callback and an `animatedStyle` to spread onto
 * an `Animated.View`. All animations are GPU-bound (transform + opacity only),
 * ≤300ms, and respect `reducedMotion`.
 */

// ── Pop variant ──────────────────────────────────────────────────────────────
// Scale pop (1 → peakScale → 1) — e.g. heart icon on favourite.

export function useSuccessPop(peakScale = 1.4): {
  trigger: () => void;
  animatedStyle: AnimatedStyle<ViewStyle>;
  scale: SharedValue<number>;
} {
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);

  const trigger = useCallback(() => {
    // Always fire haptic feedback — tactile confirmation doesn't rely on motion.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (reducedMotion) {
      // Instant state change — no animation
      return;
    }
    scale.value = withSequence(
      withSpring(peakScale, successPopConfig),
      withSpring(1, successPopConfig),
    );
  }, [reducedMotion, scale, peakScale]);

  // Cancel in-flight animation + reset scale to 1 when reducedMotion flips
  // at runtime or the component unmounts — prevents a frozen mid-pop scale.
  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(scale);
      scale.value = 1;
    }
    return () => {
      cancelAnimation(scale);
      scale.value = 1;
    };
  }, [reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { trigger, animatedStyle, scale };
}
