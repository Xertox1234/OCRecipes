import React, { forwardRef } from "react";
import {
  TextInput as RNTextInput,
  type TextInputInstance,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";

import { FocusInputShell } from "./FocusInputShell";

interface FocusTextInputProps extends Omit<TextInputProps, "style"> {
  style?: StyleProp<TextStyle>;
  /**
   * `false` when a wrapper around the input draws the visible field: wrap it
   * in `FocusField` (with `useFieldFocus`) and pass the field's handlers as
   * this input's `onFocus`/`onBlur` — never a ring inside a ring.
   */
  focusRing?: boolean;
  /**
   * Floating label drawn on the input's own field (needs `focusRing`): it
   * names the input for screen readers unless `accessibilityLabel` says more,
   * holds back the placeholder until it floats, and makes the field at least
   * 56px tall. Pass `value` so the label stays floated over typed text.
   */
  label?: string;
}

/**
 * Drop-in replacement for react-native's `TextInput` that keeps the caller's
 * own look and adds the shared focus feedback: the style's box keys (fill,
 * edge, radius, size, margins) draw a `FocusField` — 2px ring + warm fill on
 * focus, reduced-motion aware — and the text keys stay on the input. Use it for
 * composers, inline numeric fields and any input that does not fit the boxed
 * `TextInput` — never a bare RN `TextInput` (enforced by ESLint).
 */
export const FocusTextInput = forwardRef<
  TextInputInstance,
  FocusTextInputProps
>(({ style, onFocus, onBlur, focusRing, label, ...props }, ref) => (
  <FocusInputShell
    style={style}
    onFocus={onFocus}
    onBlur={onBlur}
    focusRing={focusRing}
    label={label}
    value={props.value}
    placeholder={props.placeholder}
    accessibilityLabel={props.accessibilityLabel}
    renderInput={(shellProps) => (
      <RNTextInput ref={ref} {...props} {...shellProps} />
    )}
  />
));

FocusTextInput.displayName = "FocusTextInput";
