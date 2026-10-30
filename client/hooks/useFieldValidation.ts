import { useRef, useState, type RefObject } from "react";
import type { TextInputInstance } from "react-native";

import { shouldShowError } from "@/lib/field-validation";

export type FieldValidation = {
  value: string;
  /** The error to show now, or null — already timed per spec §5.1. */
  error: string | null;
  onChangeText: (t: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** The field has focus — callers show its rule checklist (spec §5.2). */
  focused: boolean;
  /**
   * Left with text, or the main button pressed: the gate that lets `error`
   * show, also used to colour unmet checklist lines.
   */
  checked: boolean;
  /** The main button's check: show this field's error; true when valid. */
  markSubmitted: () => boolean;
  ref: RefObject<TextInputInstance | null>;
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
 *
 * Destructure the ref (`const { ref: emailRef } = email`) and never write
 * `email.ref` in render: React Compiler then treats the whole object as a
 * ref, flags every `email.value` / `email.error` read as ref access during
 * render, and skips the component (scripts/check-react-compiler-bailouts.js).
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
  const [focused, setFocused] = useState(false);
  const ref = useRef<TextInputInstance | null>(null);

  const rawError = validate(value);
  const checked = leftNonEmpty || submitAttempted;
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
    onFocus: () => setFocused(true),
    // Assigned, not sticky: a field emptied and left goes quiet again until
    // the main button flags it.
    onBlur: () => {
      setFocused(false);
      setLeftNonEmpty(value.trim() !== "");
    },
    focused,
    checked,
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
