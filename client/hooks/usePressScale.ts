import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  type SharedValue,
  type AnimatedStyle,
} from "react-native-reanimated";
import type { ViewStyle } from "react-native";

import { useAccessibility } from "@/hooks/useAccessibility";
import { pressSpringConfig } from "@/constants/animations";

/**
 * Press feedback for a pressable: scale down to `targetScale` on press-in and
 * spring back to 1 on press-out, on the clamped `pressSpringConfig`.
 *
 * This is the press tier. Celebrations (favourite, success) overshoot with
 * `useSuccessPop` instead — don't swap the two.
 *
 * Spread `animatedStyle` onto an animated pressable and wire `onPressIn` /
 * `onPressOut`. Nothing animates under reduced motion or when `enabled` is
 * false (e.g. a disabled button, or a Chip with no `onPress`).
 */
export function usePressScale(
  targetScale = 0.98,
  { enabled = true }: { enabled?: boolean } = {},
): {
  animatedStyle: AnimatedStyle<ViewStyle>;
  onPressIn: () => void;
  onPressOut: () => void;
  scale: SharedValue<number>;
} {
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);
  const active = enabled && !reducedMotion;

  const onPressIn = () => {
    if (active) {
      scale.value = withSpring(targetScale, pressSpringConfig);
    }
  };

  const onPressOut = () => {
    if (active) {
      scale.value = withSpring(1, pressSpringConfig);
    }
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { animatedStyle, onPressIn, onPressOut, scale };
}
