import {
  StyleSheet,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { focusTimingConfig } from "@/constants/animations";
import {
  compensateSyntheticBorder,
  resolveFocusBorder,
} from "./text-input-utils";

/**
 * Focus feedback for a drop-in input that keeps the caller's own look: the
 * input's border colour fades to the theme link colour on focus (see
 * `resolveFocusBorder` for how a borderless style is handled). Shared by
 * `FocusTextInput` and `FocusBottomSheetTextInput` so every raw input answers a
 * tap the same way as the boxed `TextInput`.
 *
 * Reduced motion snaps to the focused end state — the state change is kept, the
 * motion is dropped.
 */
export function useFocusBorder(
  style: StyleProp<TextStyle>,
  onFocus?: TextInputProps["onFocus"],
  onBlur?: TextInputProps["onBlur"],
  /** `false` leaves the style untouched: the ring is drawn by a container that calls this hook on its own style. */
  ring = true,
) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const progress = useSharedValue(0);

  const flat = StyleSheet.flatten(style) ?? {};
  const border = resolveFocusBorder(flat, theme.link, theme.border);
  // Plain strings captured OUTSIDE the worklet — never reach through an object
  // or call an imported function inside it.
  const restColor = border.restColor;
  const focusColor = border.focusColor;

  const timing = {
    ...focusTimingConfig,
    duration: reducedMotion ? 0 : focusTimingConfig.duration,
  };

  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      progress.get(),
      [0, 1],
      [restColor, focusColor],
    ),
  }));

  return {
    focusStyle: ring
      ? [
          style,
          { borderWidth: border.borderWidth },
          compensateSyntheticBorder(flat),
          animatedStyle,
        ]
      : style,
    onFocus: ((e) => {
      progress.set(withTiming(1, timing));
      onFocus?.(e);
    }) as NonNullable<TextInputProps["onFocus"]>,
    onBlur: ((e) => {
      progress.set(withTiming(0, timing));
      onBlur?.(e);
    }) as NonNullable<TextInputProps["onBlur"]>,
  };
}
