import { useCallback, useEffect } from "react";
import {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  type SharedValue,
  type AnimatedStyle,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { useAccessibility } from "@/hooks/useAccessibility";
import { successPopConfig, successFlashConfig } from "@/constants/animations";
import type { ViewStyle } from "react-native";

/**
 * Reusable success animation hooks.
 *
 * Each returns a `trigger()` callback and an `animatedStyle` to spread onto
 * an `Animated.View`. All animations are GPU-bound (transform + opacity only),
 * ≤300ms, and respect `reducedMotion`.
 */

// ── Flash variant ────────────────────────────────────────────────────────────
// Brief opacity flash (0 → peak → 0) — e.g. green background flash on scan.

export function useSuccessFlash(peak = 0.15): {
  trigger: () => void;
  animatedStyle: AnimatedStyle<ViewStyle>;
  opacity: SharedValue<number>;
} {
  const { reducedMotion } = useAccessibility();
  const opacity = useSharedValue(0);

  const trigger = useCallback(() => {
    // Always fire haptic feedback — even with reduced motion, users expect
    // tactile confirmation of success. Haptics is not motion.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (reducedMotion) {
      // No visual flash for reduced motion — state is already correct
      return;
    }
    opacity.value = withSequence(
      withTiming(peak, { duration: 100 }),
      withTiming(0, successFlashConfig),
    );
  }, [reducedMotion, opacity, peak]);

  // Cancel any in-flight animation + reset when reducedMotion flips at
  // runtime (e.g. user toggles the OS preference mid-session) or when the
  // component unmounts. Without this a mid-flash state change would leave
  // `opacity` stuck at its last interpolation step.
  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(opacity);
      opacity.value = 0;
    }
    return () => {
      cancelAnimation(opacity);
      opacity.value = 0;
    };
  }, [reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return { trigger, animatedStyle, opacity };
}

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
