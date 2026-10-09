import { useCallback, useEffect } from "react";
import {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  type AnimatedStyle,
} from "react-native-reanimated";
import type { ViewStyle } from "react-native";

import { useAccessibility } from "@/hooks/useAccessibility";

/**
 * Side-to-side shake for a validation reject. `shake()` runs a 200ms
 * sequence on `translateX`; spread `animatedStyle` onto an `Animated.View`.
 * GPU-bound (transform only). Under reduced motion `shake()` does nothing —
 * the error message itself still shows. No haptic: the form already fires
 * its Error haptic with the reject.
 *
 * Call `shake()` from an effect, not an event handler: on the first reject
 * the shaken view mounts in the same commit, and a shared-value write that
 * lands before that commit is lost.
 */
export function useShake(): {
  shake: () => void;
  animatedStyle: AnimatedStyle<ViewStyle>;
} {
  const { reducedMotion } = useAccessibility();
  const offset = useSharedValue(0);

  const shake = useCallback(() => {
    if (reducedMotion) return;
    offset.value = withSequence(
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(-3, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [reducedMotion, offset]);

  // Cancel an in-flight shake and re-centre when reducedMotion flips at
  // runtime or the component unmounts — never leave the view off-centre.
  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(offset);
      offset.value = 0;
    }
    return () => {
      cancelAnimation(offset);
      offset.value = 0;
    };
  }, [reducedMotion, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return { shake, animatedStyle };
}
