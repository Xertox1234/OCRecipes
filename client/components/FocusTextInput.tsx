import React, { forwardRef } from "react";
import {
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { useFocusBorder } from "./useFocusBorder";

// Reanimated 4.3 types createAnimatedComponent loosely; restore the input's
// own props/ref (same cast RecipeBrowserScreen uses for its SectionList).
const AnimatedRNTextInput = Animated.createAnimatedComponent(
  RNTextInput,
) as unknown as typeof RNTextInput;

interface FocusTextInputProps extends Omit<TextInputProps, "style"> {
  style?: StyleProp<TextStyle>;
}

/**
 * Drop-in replacement for react-native's `TextInput` that keeps the caller's
 * own look and adds the shared focus feedback (border fades to the link
 * colour, reduced-motion aware). Use it for composers, inline numeric fields
 * and any input that does not fit the boxed `TextInput` — never a bare RN
 * `TextInput` (enforced by ESLint).
 */
export const FocusTextInput = forwardRef<RNTextInput, FocusTextInputProps>(
  ({ style, onFocus, onBlur, ...props }, ref) => {
    const focus = useFocusBorder(style, onFocus, onBlur);
    return (
      <AnimatedRNTextInput
        ref={ref}
        {...props}
        style={focus.focusStyle as StyleProp<TextStyle>}
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
      />
    );
  },
);

FocusTextInput.displayName = "FocusTextInput";
