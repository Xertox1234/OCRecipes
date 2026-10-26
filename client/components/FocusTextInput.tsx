import React, { forwardRef } from "react";
import {
  StyleSheet,
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";

import { FocusField } from "./FocusField";
import { FIELD_INPUT_FILL, splitFieldStyle } from "./field-focus-utils";
import { useFieldFocus } from "./useFieldFocus";

interface FocusTextInputProps extends Omit<TextInputProps, "style"> {
  style?: StyleProp<TextStyle>;
  /**
   * `false` when a wrapper around the input draws the visible field: wrap it
   * in `FocusField` (with `useFieldFocus`) and pass the field's handlers as
   * this input's `onFocus`/`onBlur` — never a ring inside a ring.
   */
  focusRing?: boolean;
}

/**
 * Drop-in replacement for react-native's `TextInput` that keeps the caller's
 * own look and adds the shared focus feedback: the style's box keys (fill,
 * edge, radius, size, margins) draw a `FocusField` — 2px ring + warm fill on
 * focus, reduced-motion aware — and the text keys stay on the input. Use it for
 * composers, inline numeric fields and any input that does not fit the boxed
 * `TextInput` — never a bare RN `TextInput` (enforced by ESLint).
 */
export const FocusTextInput = forwardRef<RNTextInput, FocusTextInputProps>(
  ({ style, onFocus, onBlur, focusRing = true, ...props }, ref) => {
    const field = useFieldFocus({ onFocus, onBlur });

    if (!focusRing) {
      return (
        <RNTextInput
          ref={ref}
          {...props}
          style={style}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      );
    }

    const { box, text } = splitFieldStyle(StyleSheet.flatten(style) ?? {});
    return (
      <FocusField focus={field} style={box}>
        <RNTextInput
          ref={ref}
          {...props}
          style={{ ...text, ...FIELD_INPUT_FILL }}
          onFocus={field.onFocus}
          onBlur={field.onBlur}
        />
      </FocusField>
    );
  },
);

FocusTextInput.displayName = "FocusTextInput";
