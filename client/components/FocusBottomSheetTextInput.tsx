import React, { forwardRef } from "react";
import { StyleSheet, type StyleProp, type TextStyle } from "react-native";
import type { TextInput } from "react-native-gesture-handler";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";

import { FocusField } from "./FocusField";
import {
  FIELD_INPUT_FILL,
  labelFieldText,
  splitFieldStyle,
} from "./field-focus-utils";
import {
  resolveInputAccessibilityLabel,
  resolvePlaceholder,
  shouldFloatLabel,
} from "./text-input-utils";
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
  TextInput,
  FocusBottomSheetTextInputProps
>(({ style, onFocus, onBlur, focusRing = true, label, ...props }, ref) => {
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

  const { box, text: ownText } = splitFieldStyle(
    StyleSheet.flatten(style) ?? {},
  );
  const labelled = label ? labelFieldText(ownText) : null;
  const text = labelled?.text ?? ownText;
  return (
    <FocusField
      focus={field}
      style={box}
      label={label}
      hasValue={(props.value?.length ?? 0) > 0}
      labelLeft={labelled?.labelLeft}
    >
      <BottomSheetTextInput
        ref={ref}
        {...props}
        placeholder={resolvePlaceholder(
          label,
          props.placeholder,
          shouldFloatLabel(field.focused, props.value),
        )}
        accessibilityLabel={resolveInputAccessibilityLabel(
          props.accessibilityLabel,
          label,
        )}
        style={{ ...text, ...FIELD_INPUT_FILL }}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
      />
    </FocusField>
  );
});

FocusBottomSheetTextInput.displayName = "FocusBottomSheetTextInput";
