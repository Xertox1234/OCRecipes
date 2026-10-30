import { describe, it, expect, vi } from "vitest";
import type { RefObject } from "react";
import type { TextInputInstance } from "react-native";

import { shouldShowError, focusFirstInvalid } from "../field-validation";

function fakeField(valid: boolean) {
  const focus = vi.fn();
  return {
    markSubmitted: vi.fn(() => valid),
    ref: {
      current: { focus },
    } as unknown as RefObject<TextInputInstance | null>,
    focus,
  };
}

describe("shouldShowError", () => {
  const base = { value: "x", leftNonEmpty: false, submitAttempted: false };

  it("never shows a null error", () => {
    expect(
      shouldShowError({
        ...base,
        leftNonEmpty: true,
        submitAttempted: true,
        error: null,
      }),
    ).toBe(false);
  });

  it("hides an error while the field is first being typed", () => {
    expect(shouldShowError({ ...base, error: "Too short" })).toBe(false);
  });

  it("shows an error once the field was left with text", () => {
    expect(
      shouldShowError({ ...base, leftNonEmpty: true, error: "Too short" }),
    ).toBe(true);
  });

  it("shows an error once the main button was pressed", () => {
    expect(
      shouldShowError({ ...base, submitAttempted: true, error: "Required" }),
    ).toBe(true);
  });
});

describe("focusFirstInvalid", () => {
  it("focuses the second of three when only it is invalid", () => {
    const a = fakeField(true);
    const b = fakeField(false);
    const c = fakeField(true);
    expect(focusFirstInvalid([a, b, c])).toBe(false);
    expect(b.focus).toHaveBeenCalledTimes(1);
    expect(a.focus).not.toHaveBeenCalled();
    expect(c.focus).not.toHaveBeenCalled();
  });

  it("marks every field submitted, even after the first invalid one", () => {
    const a = fakeField(false);
    const b = fakeField(false);
    focusFirstInvalid([a, b]);
    expect(a.markSubmitted).toHaveBeenCalled();
    expect(b.markSubmitted).toHaveBeenCalled();
    expect(a.focus).toHaveBeenCalledTimes(1);
    expect(b.focus).not.toHaveBeenCalled();
  });

  it("returns true and focuses nothing when every field is valid", () => {
    const a = fakeField(true);
    const b = fakeField(true);
    expect(focusFirstInvalid([a, b])).toBe(true);
    expect(a.focus).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();
  });
});
