// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useFieldValidation } from "../useFieldValidation";

const minThree = (v: string) =>
  v.trim() === "" ? "Required" : v.trim().length < 3 ? "Too short" : null;

describe("useFieldValidation", () => {
  it("shows no error after focus and typing invalid text without leaving", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    act(() => result.current.onChangeText("a"));
    expect(result.current.value).toBe("a");
    expect(result.current.error).toBeNull();
  });

  it("shows the error after leaving a field that has text", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    act(() => result.current.onChangeText("a"));
    act(() => result.current.onBlur());
    expect(result.current.error).toBe("Too short");
  });

  it("shows no error after leaving an empty field", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    act(() => result.current.onBlur());
    expect(result.current.error).toBeNull();
  });

  it("does not flag a field cleared and then left (empty waits for the button)", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    act(() => result.current.onChangeText("abcd"));
    act(() => result.current.onBlur());
    act(() => result.current.onChangeText(""));
    act(() => result.current.onBlur());
    expect(result.current.error).toBeNull();
  });

  it("flags an empty field after markSubmitted, which reports invalid", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    let valid = true;
    act(() => {
      valid = result.current.markSubmitted();
    });
    expect(valid).toBe(false);
    expect(result.current.error).toBe("Required");
  });

  it("markSubmitted reports valid for a valid value", () => {
    const { result } = renderHook(() => useFieldValidation(minThree, "abc"));
    let valid = false;
    act(() => {
      valid = result.current.markSubmitted();
    });
    expect(valid).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("re-checks every keystroke once shown and clears on the one that makes it valid", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    act(() => result.current.onChangeText("a"));
    act(() => result.current.onBlur());
    act(() => result.current.onChangeText("ab"));
    expect(result.current.error).toBe("Too short");
    act(() => result.current.onChangeText("abc"));
    expect(result.current.error).toBeNull();
  });

  it("re-runs a validator that reads another field's latest value", () => {
    let other = "secret1";
    const { result, rerender } = renderHook(() =>
      useFieldValidation((v) => (v === other ? null : "No match")),
    );
    act(() => result.current.onChangeText("secret1"));
    act(() => {
      result.current.markSubmitted();
    });
    expect(result.current.error).toBeNull();
    other = "secret2";
    rerender();
    expect(result.current.error).toBe("No match");
  });

  it("starts from initialValue; setValue and reset change it", () => {
    const { result } = renderHook(() => useFieldValidation(minThree, "abc"));
    expect(result.current.value).toBe("abc");
    act(() => result.current.setValue(""));
    expect(result.current.value).toBe("");
    act(() => {
      result.current.markSubmitted();
    });
    expect(result.current.error).toBe("Required");
    act(() => result.current.reset());
    expect(result.current.value).toBe("abc");
    expect(result.current.error).toBeNull();
  });

  it("counts invalid submits in shakeKey; blur and valid submits leave it", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    expect(result.current.shakeKey).toBe(0);
    act(() => result.current.onChangeText("a"));
    act(() => result.current.onBlur());
    expect(result.current.shakeKey).toBe(0);
    act(() => {
      result.current.markSubmitted();
    });
    act(() => {
      result.current.markSubmitted();
    });
    expect(result.current.shakeKey).toBe(2);
    act(() => result.current.onChangeText("abc"));
    act(() => {
      result.current.markSubmitted();
    });
    expect(result.current.shakeKey).toBe(2);
  });

  it("tracks focus: onFocus sets focused, onBlur clears it", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    expect(result.current.focused).toBe(false);
    act(() => result.current.onFocus());
    expect(result.current.focused).toBe(true);
    act(() => result.current.onBlur());
    expect(result.current.focused).toBe(false);
  });

  it("is checked once left with text or submitted, the same gate as its error", () => {
    const { result } = renderHook(() => useFieldValidation(minThree));
    expect(result.current.checked).toBe(false);
    act(() => result.current.onBlur());
    expect(result.current.checked).toBe(false);
    act(() => result.current.onChangeText("abcd"));
    act(() => result.current.onBlur());
    expect(result.current.checked).toBe(true);
    act(() => result.current.reset(""));
    expect(result.current.checked).toBe(false);
    act(() => {
      result.current.markSubmitted();
    });
    expect(result.current.checked).toBe(true);
  });
});
