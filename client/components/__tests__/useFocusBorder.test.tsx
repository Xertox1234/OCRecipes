// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import type { TextInputProps } from "react-native";
import { useFocusBorder } from "../useFocusBorder";

// The shared reanimated mock freezes the border colour at its end state, so a
// regression that stopped animating would still pass. Here the shared value is
// ref-backed and the colour interpolation follows it, so the test sees the
// colour the focus handlers actually drive.
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
    interpolateColor: (value: number, _in: number[], out: string[]) =>
      value >= 1 ? out[1] : out[0],
    withTiming: (val: number) => val,
  };
});

type FocusEvent = Parameters<NonNullable<TextInputProps["onFocus"]>>[0];
const focusEvent = {} as FocusEvent;

function borderColorOf(result: { current: ReturnType<typeof useFocusBorder> }) {
  const style = result.current.focusStyle as Record<string, unknown>[];
  return style[style.length - 1].borderColor;
}

describe("useFocusBorder", () => {
  it("fades a bordered input's own border colour to the link colour on focus and back on blur", () => {
    const { result, rerender } = renderHook(() =>
      useFocusBorder({ borderWidth: 1, borderColor: "#112233" }),
    );
    expect(borderColorOf(result)).toBe("#112233");

    act(() => {
      result.current.onFocus(focusEvent);
    });
    rerender();
    const focused = borderColorOf(result);
    expect(focused).not.toBe("#112233");

    act(() => {
      result.current.onBlur(focusEvent);
    });
    rerender();
    expect(borderColorOf(result)).toBe("#112233");
  });

  it("gives a borderless input a 1px border resting fully transparent", () => {
    const { result, rerender } = renderHook(() =>
      useFocusBorder({ paddingVertical: 8 }),
    );
    const style = result.current.focusStyle as Record<string, unknown>[];
    expect(style).toContainEqual({ borderWidth: 1 });
    // link colour at alpha 00 ("#RRGGBB00") at rest, the opaque link colour on focus
    const rest = borderColorOf(result) as string;
    expect(rest).toMatch(/^#[0-9a-fA-F]{6}00$/);

    act(() => {
      result.current.onFocus(focusEvent);
    });
    rerender();
    expect(borderColorOf(result)).toBe(rest.slice(0, 7));
  });

  it("cancels the added border with padding so a borderless input keeps its size", () => {
    const { result } = renderHook(() =>
      useFocusBorder({ paddingVertical: 8, paddingHorizontal: 0 }),
    );
    const style = result.current.focusStyle as Record<string, unknown>[];
    expect(style).toContainEqual(
      expect.objectContaining({
        paddingTop: 7,
        paddingBottom: 7,
        marginLeft: -1,
        marginRight: -1,
      }),
    );
  });

  it("leaves the style alone when a container draws the ring", () => {
    const own = { paddingVertical: 8 };
    const onFocus = vi.fn();
    const { result } = renderHook(() =>
      useFocusBorder(own, onFocus, undefined, false),
    );
    expect(result.current.focusStyle).toBe(own);
    act(() => {
      result.current.onFocus(focusEvent);
    });
    expect(onFocus).toHaveBeenCalledOnce();
  });
});
