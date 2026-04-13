import { useCallback } from "react";
import {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
  type SharedValue,
  type AnimatedStyle,
} from "react-native-reanimated";

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
    if (reducedMotion) {
      // No visual flash for reduced motion — state is already correct
      return;
    }
    opacity.value = withSequence(
      withTiming(peak, { duration: 100 }),
      withTiming(0, successFlashConfig),
    );
  }, [reducedMotion, opacity, peak]);

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
    if (reducedMotion) {
      // Instant state change — no animation
      return;
    }
    scale.value = withSequence(
      withSpring(peakScale, successPopConfig),
      withSpring(1, successPopConfig),
    );
  }, [reducedMotion, scale, peakScale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { trigger, animatedStyle, scale };
}
