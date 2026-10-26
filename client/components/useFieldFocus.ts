import { useState } from "react";
import type { TextInputProps } from "react-native";
import {
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useAccessibility } from "@/hooks/useAccessibility";
import { focusTimingConfig } from "@/constants/animations";

/** Focus state of one text field, handed to `FocusField` and the input. */
export type FieldFocus = {
  focused: boolean;
  /** 0 at rest → 1 focused, animated over `focusTimingConfig`. */
  progress: SharedValue<number>;
  onFocus: NonNullable<TextInputProps["onFocus"]>;
  onBlur: NonNullable<TextInputProps["onBlur"]>;
};

/**
 * Focus tracking for a text field drawn with `FocusField`. Spread `onFocus` /
 * `onBlur` onto the input and pass the whole object to `FocusField`; the
 * caller's own handlers still run.
 *
 * Reduced motion snaps to the end state (duration 0) — the state change is
 * kept, only the motion is dropped.
 */
export function useFieldFocus(opts?: {
  onFocus?: TextInputProps["onFocus"];
  onBlur?: TextInputProps["onBlur"];
}): FieldFocus {
  const { reducedMotion } = useAccessibility();
  const [focused, setFocused] = useState(false);
  const progress = useSharedValue(0);

  const timing = {
    ...focusTimingConfig,
    duration: reducedMotion ? 0 : focusTimingConfig.duration,
  };

  return {
    focused,
    progress,
    onFocus: (e) => {
      setFocused(true);
      progress.set(withTiming(1, timing));
      opts?.onFocus?.(e);
    },
    onBlur: (e) => {
      setFocused(false);
      progress.set(withTiming(0, timing));
      opts?.onBlur?.(e);
    },
  };
}
