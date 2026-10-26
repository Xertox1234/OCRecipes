import { useRef, useState, type RefObject } from "react";
import type { TextInput as RNTextInput } from "react-native";

import { shouldShowError } from "@/lib/field-validation";

export type FieldValidation = {
  value: string;
  /** The error to show now, or null — already timed per spec §5.1. */
  error: string | null;
  onChangeText: (t: string) => void;
  onBlur: () => void;
  /** The main button's check: show this field's error; true when valid. */
  markSubmitted: () => boolean;
  ref: RefObject<RNTextInput | null>;
  /**
   * Bumped by each `markSubmitted` that finds the value invalid — pass to
   * this field's `InlineError` so a submit reject shakes it and a blur never
   * does (interaction-feel "Shipped shake pattern").
   */
  shakeKey: number;
  /** Replace the text without touching the timing (e.g. clear a rejected password). */
  setValue: (t: string) => void;
  /** Back to `next` (default: the initial value) with no error showing. */
  reset: (next?: string) => void;
};

/**
 * One text field's value and error timing (form-fields spec §5.1). `validate`
 * runs on every render against the current value, so it may read other
 * fields' latest values (e.g. a confirm field) and a shown error clears on the
 * keystroke that makes the value valid.
 *
 * - No error while first typing.
 * - Leaving the field with text shows its error; leaving it empty does not —
 *   an empty required field waits for the main button (`markSubmitted`).
 * - After `markSubmitted`, every error shows.
 */
export function useFieldValidation(
  validate: (value: string) => string | null,
  initialValue = "",
): FieldValidation {
  const [initial] = useState(initialValue);
  const [value, setValue] = useState(initialValue);
  const [leftNonEmpty, setLeftNonEmpty] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const ref = useRef<RNTextInput | null>(null);

  const rawError = validate(value);
  const error = shouldShowError({
    value,
    leftNonEmpty,
    submitAttempted,
    error: rawError,
  })
    ? rawError
    : null;

  return {
    value,
    error,
    onChangeText: setValue,
    // Assigned, not sticky: a field emptied and left goes quiet again until
    // the main button flags it.
    onBlur: () => setLeftNonEmpty(value.trim() !== ""),
    markSubmitted: () => {
      setSubmitAttempted(true);
      const valid = validate(value) === null;
      if (!valid) setShakeKey((k) => k + 1);
      return valid;
    },
    ref,
    shakeKey,
    setValue,
    reset: (next = initial) => {
      setValue(next);
      setLeftNonEmpty(false);
      setSubmitAttempted(false);
    },
  };
}
