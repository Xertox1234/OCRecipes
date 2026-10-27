import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform, type ViewStyle } from "react-native";
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from "react-native-reanimated";

import { useAccessibility } from "@/hooks/useAccessibility";
import { volumeToScale } from "@/lib/volume-scale";

/**
 * Mic-button pulse: while listening, the button scales with the input volume
 * (`amplitude` = extra scale at max volume, e.g. 0.3 → 1.0..1.3); it settles
 * back to 1 when listening stops and holds at 1 under reduced motion. Also
 * announces "Listening started/stopped" on iOS — the caller's
 * `accessibilityLiveRegion="polite"` wrapper covers Android, so announcing
 * there too would double-read. Spread `animatedStyle` onto the wrapper.
 */
export function useMicPulse(
  isListening: boolean,
  volume: number,
  amplitude: number,
): AnimatedStyle<ViewStyle> {
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(scale);
      scale.set(1);
      return;
    }
    if (isListening) {
      scale.set(
        withTiming(volumeToScale(volume, amplitude), { duration: 100 }),
      );
    } else {
      cancelAnimation(scale);
      scale.set(withTiming(1, { duration: 200 }));
    }
  }, [isListening, volume, amplitude, scale, reducedMotion]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        isListening ? "Listening started" : "Listening stopped",
      );
    }
  }, [isListening]);

  return useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
}
