import React, { forwardRef } from "react";
import {
  type StyleProp,
  type TextInputInstance,
  type TextStyle,
} from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { FocusInputShell } from "./FocusInputShell";

type SheetInputProps = React.ComponentProps<typeof BottomSheetTextInput>;
type SheetInputRef = React.Ref<React.ComponentRef<typeof BottomSheetTextInput>>;

interface FocusBottomSheetTextInputProps
  extends Omit<SheetInputProps, "style"> {
  style?: StyleProp<TextStyle>;
  /**
   * `false` when a container around the input draws the visible field: wrap it
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
 * `BottomSheetTextInput` with the shared focus feedback — the sibling of
 * `FocusTextInput` for inputs inside a gorhom bottom sheet. gorhom's component
 * stays the actual input: it tracks keyboard focus for the sheet.
 */
export const FocusBottomSheetTextInput = forwardRef<
  TextInputInstance,
  FocusBottomSheetTextInputProps
>(({ style, onFocus, onBlur, focusRing, label, ...props }, ref) => {
  // gorhom 5.2 still types its ref with gesture-handler 2's TextInput; under
  // gesture-handler 3 the ref it hands back is RN's TextInputInstance.
  const sheetRef = ref as SheetInputRef;

  return (
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
        <BottomSheetTextInput ref={sheetRef} {...props} {...shellProps} />
      )}
    />
  );
});

FocusBottomSheetTextInput.displayName = "FocusBottomSheetTextInput";
