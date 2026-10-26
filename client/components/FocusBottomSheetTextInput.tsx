import React, { forwardRef } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import type { TextInput } from "react-native-gesture-handler";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { FocusField } from "./FocusField";
import { FIELD_INPUT_FILL, splitFieldStyle } from "./field-focus-utils";
import { useFieldFocus } from "./useFieldFocus";

type SheetInputProps = React.ComponentProps<typeof BottomSheetTextInput>;

interface FocusBottomSheetTextInputProps
  extends Omit<SheetInputProps, "style"> {
  style?: StyleProp<TextStyle>;
  /**
   * `false` when a container around the input draws the visible field: wrap it
   * in `FocusField` (with `useFieldFocus`) and pass the field's handlers as
   * this input's `onFocus`/`onBlur` — never a ring inside a ring.
   */
  focusRing?: boolean;
}

/**
 * `BottomSheetTextInput` with the shared focus feedback — the sibling of
 * `FocusTextInput` for inputs inside a gorhom bottom sheet. gorhom's component
 * stays the actual input: it tracks keyboard focus for the sheet.
 */
export const FocusBottomSheetTextInput = forwardRef<
  TextInput,
  FocusBottomSheetTextInputProps
>(({ style, onFocus, onBlur, focusRing = true, ...props }, ref) => {
  const field = useFieldFocus({ onFocus, onBlur });

  if (!focusRing) {
    return (
      <BottomSheetTextInput
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
      <BottomSheetTextInput
        ref={ref}
        {...props}
        style={{ ...text, ...FIELD_INPUT_FILL }}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
      />
    </FocusField>
  );
});

FocusBottomSheetTextInput.displayName = "FocusBottomSheetTextInput";
