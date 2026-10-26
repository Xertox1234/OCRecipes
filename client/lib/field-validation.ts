/**
 * When a field's error is shown — form-fields spec §5.1:
 * never on focus or while first typing; once the field is left with text, or
 * once the main button is pressed. A shown error is re-checked every keystroke
 * (the caller re-derives `error` from the current value on each render).
 */
import type { RefObject } from "react";
import type { TextInput as RNTextInput } from "react-native";

export function shouldShowError(s: {
  value: string;
  leftNonEmpty: boolean;
  submitAttempted: boolean;
  error: string | null;
}): boolean {
  return s.error !== null && (s.leftNonEmpty || s.submitAttempted);
}

/**
 * The main button's check: marks every field submitted (so each shows its
 * error), focuses the first invalid one, and returns whether all are valid.
 */
export function focusFirstInvalid(
  fields: {
    markSubmitted: () => boolean;
    ref: RefObject<RNTextInput | null>;
  }[],
): boolean {
  let firstInvalid: (typeof fields)[number] | null = null;
  for (const field of fields) {
    const valid = field.markSubmitted();
    if (!valid && !firstInvalid) firstInvalid = field;
  }
  firstInvalid?.ref.current?.focus();
  return firstInvalid === null;
}
