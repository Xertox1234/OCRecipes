// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useCollapsibleHeight } from "../useCollapsibleHeight";

vi.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- mock needs synchronous require
  const { useRef } = require("react");
  return {
    useSharedValue: (initial: number) => {
      // Use useRef so the same object persists across re-renders (like real Reanimated)
      const ref = useRef<{ value: number } | null>(null);
      if (ref.current === null) {
        ref.current = { value: initial };
      }
      return ref.current;
    },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => {
      // Store fn in a ref so the returned proxy always uses the latest closure
      const ref = useRef(fn);
      ref.current = fn;
      // Return a Proxy that re-evaluates fn() on property access,
      // simulating Reanimated's reactive style updates
      return new Proxy(
        {},
        {
          get(_, prop) {
            return ref.current()[prop as string];
          },
          ownKeys() {
            return Object.keys(ref.current());
          },
          getOwnPropertyDescriptor(_, prop) {
            const val = ref.current();
            if (prop in val) {
              return {
                configurable: true,
                enumerable: true,
                value: val[prop as string],
              };
            }
            return undefined;
          },
        },
      );
    },
    withTiming: (toValue: number, _config?: object, _cb?: unknown) => toValue,
  };
});

vi.mock("@/constants/animations", () => ({
  expandTimingConfig: { duration: 300 },
  collapseTimingConfig: { duration: 250 },
}));

describe("useCollapsibleHeight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns animatedStyle and onContentLayout", () => {
    const { result } = renderHook(() => useCollapsibleHeight(true, false));

    expect(result.current.animatedStyle).toBeDefined();
    expect(typeof result.current.onContentLayout).toBe("function");
  });

  it("starts with zero height before measurement", () => {
    const { result } = renderHook(() => useCollapsibleHeight(true, false));

    // Before onContentLayout fires, height is 0
    expect(result.current.animatedStyle).toEqual({
      height: 0,
    });
  });

  it("snaps to measured height on first layout when expanded", () => {
    const { result } = renderHook(() => useCollapsibleHeight(true, false));

    act(() => {
      result.current.onContentLayout({
        nativeEvent: { layout: { height: 200 } },
      });
    });

    expect(result.current.animatedStyle).toEqual({
      height: 200,
    });
  });

  it("starts with zero height when initially collapsed", () => {
    const { result } = renderHook(() => useCollapsibleHeight(false, false));

    expect(result.current.animatedStyle).toEqual({
      height: 0,
    });
  });

  it("animates to measured height on expand", () => {
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

    // withTiming is mocked to return the target value immediately (200)
    expect(result.current.animatedStyle).toEqual({
      height: 200,
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
    });

    // Re-expand with reduced motion
    rerender({ expanded: true, motion: true });

    expect(result.current.animatedStyle).toEqual({
      height: 150,
    });
  });

  it("tracks content resize while expanded", () => {
    const { result } = renderHook(() => useCollapsibleHeight(true, false));

    // First measurement
    act(() => {
      result.current.onContentLayout({
        nativeEvent: { layout: { height: 200 } },
      });
    });

    expect(result.current.animatedStyle).toEqual({
      height: 200,
    });

    // Content resizes
    act(() => {
      result.current.onContentLayout({
        nativeEvent: { layout: { height: 300 } },
      });
    });

    expect(result.current.animatedStyle).toEqual({
      height: 300,
    });
  });
});
