// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import type { TextInputProps } from "react-native";
import * as Reanimated from "react-native-reanimated";
import { useFieldFocus } from "../useFieldFocus";

// Ref-backed shared value so `progress` survives re-renders and the test sees
// what the focus handlers actually drive; `withTiming` is a spy so the timing
// config (reduced motion → duration 0) is observable.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSharedValue: (init: number) => {
      const ref = React.useRef<{
        value: number;
        get: () => number;
        set: (n: number) => void;
      }>(null);
      if (!ref.current) {
        const sv = {
          value: init,
          get: () => sv.value,
          set: (n: number) => {
            sv.value = n;
          },
        };
        ref.current = sv;
      }
      return ref.current;
    },
    withTiming: vi.fn((val: number) => val),
  };
});

type FocusEvent = Parameters<NonNullable<TextInputProps["onFocus"]>>[0];
type BlurEvent = Parameters<NonNullable<TextInputProps["onBlur"]>>[0];
const focusEvent = {} as FocusEvent;
const blurEvent = {} as BlurEvent;

describe("useFieldFocus", () => {
  afterEach(() => {
    vi.mocked(Reanimated.withTiming).mockClear();
  });

  it("tracks focus and drives progress to 1 on focus and back to 0 on blur", () => {
    const { result } = renderHook(() => useFieldFocus());
    expect(result.current.focused).toBe(false);
    expect(result.current.progress.get()).toBe(0);

    act(() => result.current.onFocus(focusEvent));
    expect(result.current.focused).toBe(true);
    expect(result.current.progress.get()).toBe(1);

    act(() => result.current.onBlur(blurEvent));
    expect(result.current.focused).toBe(false);
    expect(result.current.progress.get()).toBe(0);
  });

  it("calls the caller's onFocus and onBlur once each", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const { result } = renderHook(() => useFieldFocus({ onFocus, onBlur }));

    act(() => result.current.onFocus(focusEvent));
    act(() => result.current.onBlur(blurEvent));

    expect(onFocus).toHaveBeenCalledOnce();
    expect(onFocus).toHaveBeenCalledWith(focusEvent);
    expect(onBlur).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledWith(blurEvent);
  });

  it("animates over the focus timing (160ms) by default", () => {
    const { result } = renderHook(() => useFieldFocus());
    act(() => result.current.onFocus(focusEvent));
    expect(Reanimated.withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: 160 }),
    );
  });

  it("snaps (duration 0) under reduced motion but still changes state", () => {
    const spy = vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    try {
      const { result } = renderHook(() => useFieldFocus());
      act(() => result.current.onFocus(focusEvent));
      expect(Reanimated.withTiming).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ duration: 0 }),
      );
      expect(result.current.progress.get()).toBe(1);
      expect(result.current.focused).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
