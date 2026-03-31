// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useCollapsibleHeight } from "../useCollapsibleHeight";

// Track shared value assignments to verify animation logic
const sharedValues: Record<string, { value: number }> = {};
let sharedValueCounter = 0;

vi.mock("react-native-reanimated", () => ({
  useSharedValue: (initial: number) => {
    const id = `sv_${sharedValueCounter++}`;
    const sv = { value: initial };
    sharedValues[id] = sv;
    return sv;
  },
  useAnimatedStyle: (fn: () => object) => fn(),
  withTiming: (toValue: number, _config?: object, _cb?: unknown) => toValue,
}));

vi.mock("@/constants/animations", () => ({
  collapseTimingConfig: { duration: 250 },
}));

describe("useCollapsibleHeight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedValueCounter = 0;
    for (const key of Object.keys(sharedValues)) {
      delete sharedValues[key];
    }
  });

  it("returns animatedStyle and onContentLayout", () => {
    const { result } = renderHook(() => useCollapsibleHeight(true, false));

    expect(result.current.animatedStyle).toBeDefined();
    expect(typeof result.current.onContentLayout).toBe("function");
  });

  it("starts with auto height (-1) when initially expanded", () => {
    const { result } = renderHook(() => useCollapsibleHeight(true, false));

    // animatedStyle should reflect auto (overflow: visible)
    expect(result.current.animatedStyle).toEqual({
      height: "auto",
      overflow: "visible",
    });
  });

  it("starts with zero height when initially collapsed", () => {
    const { result } = renderHook(() => useCollapsibleHeight(false, false));

    // animatedStyle should reflect height 0
    expect(result.current.animatedStyle).toEqual({
      height: 0,
      overflow: "hidden",
    });
  });

  it("sets auto height on expand after content is measured", () => {
    const { result, rerender } = renderHook(
      ({ expanded }) => useCollapsibleHeight(expanded, false),
      { initialProps: { expanded: false } },
    );

    // Simulate content layout measurement
    act(() => {
      result.current.onContentLayout({
        nativeEvent: { layout: { height: 200 } },
      });
    });

    // Expand
    rerender({ expanded: true });

    // Should be auto (-1 → overflow: visible)
    expect(result.current.animatedStyle).toEqual({
      height: "auto",
      overflow: "visible",
    });
  });

  it("collapses to zero height", () => {
    const { result, rerender } = renderHook(
      ({ expanded }) => useCollapsibleHeight(expanded, false),
      { initialProps: { expanded: true } },
    );

    // Simulate content layout measurement
    act(() => {
      result.current.onContentLayout({
        nativeEvent: { layout: { height: 200 } },
      });
    });

    // Collapse
    rerender({ expanded: false });

    // withTiming is mocked to return the target value immediately (0)
    expect(result.current.animatedStyle).toEqual({
      height: 0,
      overflow: "hidden",
    });
  });

  it("uses instant transition when reducedMotion is true", () => {
    const { result, rerender } = renderHook(
      ({ expanded, motion }) => useCollapsibleHeight(expanded, motion),
      { initialProps: { expanded: true, motion: false } },
    );

    // Measure content
    act(() => {
      result.current.onContentLayout({
        nativeEvent: { layout: { height: 150 } },
      });
    });

    // Collapse with reduced motion
    rerender({ expanded: false, motion: true });

    expect(result.current.animatedStyle).toEqual({
      height: 0,
      overflow: "hidden",
    });

    // Re-expand with reduced motion
    rerender({ expanded: true, motion: true });

    expect(result.current.animatedStyle).toEqual({
      height: "auto",
      overflow: "visible",
    });
  });
});
