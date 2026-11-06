import React from "react";
import {
  StyleSheet,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";

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

/** The props the shell sets on the inner input, over the caller's own. */
export interface FocusInputShellInputProps {
  style: StyleProp<TextStyle>;
  onFocus: TextInputProps["onFocus"];
  onBlur: TextInputProps["onBlur"];
  placeholder?: string;
  accessibilityLabel?: string;
}

interface FocusInputShellProps {
  style?: StyleProp<TextStyle>;
  onFocus?: TextInputProps["onFocus"];
  onBlur?: TextInputProps["onBlur"];
  focusRing?: boolean;
  label?: string;
  value?: string;
  placeholder?: string;
  accessibilityLabel?: string;
  /**
   * Renders the actual input: spread the caller's own props first, then
   * `shellProps`, so the shell's style, handlers, placeholder and label win.
   */
  renderInput: (shellProps: FocusInputShellInputProps) => React.ReactElement;
}

/**
 * The focus-feedback shell shared by `FocusTextInput` and
 * `FocusBottomSheetTextInput`: the style's box keys draw a `FocusField` and
 * the text keys stay on the inner input, which each caller supplies.
 */
export function FocusInputShell({
  style,
  onFocus,
  onBlur,
  focusRing = true,
  label,
  value,
  placeholder,
  accessibilityLabel,
  renderInput,
}: FocusInputShellProps) {
  const field = useFieldFocus({ onFocus, onBlur });

  if (!focusRing) {
    return renderInput({ style, onFocus, onBlur });
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
      hasValue={(value?.length ?? 0) > 0}
      labelLeft={labelled?.labelLeft}
    >
      {renderInput({
        placeholder: resolvePlaceholder(
          label,
          placeholder,
          shouldFloatLabel(field.focused, value),
        ),
        accessibilityLabel: resolveInputAccessibilityLabel(
          accessibilityLabel,
          label,
        ),
        style: { ...text, ...FIELD_INPUT_FILL },
        onFocus: field.onFocus,
        onBlur: field.onBlur,
      })}
    </FocusField>
  );
}
