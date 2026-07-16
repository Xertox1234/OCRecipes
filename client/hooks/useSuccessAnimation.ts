import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
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
 * Success animation hook.
 *
 * `useSuccessPop` returns a `trigger()` callback and an `animatedStyle` to
 * spread onto an `Animated.View`. GPU-bound (transform only), ≤300ms. The
 * scale animation respects `reducedMotion`; the haptic intentionally does
 * not — see `trigger()`.
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
    // This deliberately bypasses reducedMotion, so it can't delegate to
    // useHaptics().notification() (which gates on it) — routed to Android's
    // performAndroidHapticsAsync directly instead, matching useHaptics.ts's
    // routing so this haptic also respects the system "Vibration & haptics"
    // toggle (notificationAsync bypasses it on Android).
    if (Platform.OS === "android") {
      void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm);
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
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
