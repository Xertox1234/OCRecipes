// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { useScrollLinkedHeader } from "../useScrollLinkedHeader";

vi.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- mock needs synchronous require
  const { useRef, useCallback } = require("react");
  return {
    useSharedValue: (initial: number) => {
      const ref = useRef(null as { value: number } | null);
      if (ref.current === null) {
        ref.current = { value: initial };
      }
      return ref.current;
    },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => {
      const ref = useRef(fn);
      ref.current = fn;
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
    useAnimatedScrollHandler: (handlers: {
      onScroll?: (event: { contentOffset: { y: number } }) => void;
    }) => {
      const ref = useRef(handlers);
      ref.current = handlers;
      return useCallback(
        (event: { nativeEvent: { contentOffset: { y: number } } }) => {
          ref.current.onScroll?.({
            contentOffset: event.nativeEvent.contentOffset,
          });
        },
        [],
      );
    },
    interpolate: (
      value: number,
      inputRange: number[],
      outputRange: number[],
    ) => {
      // Simple linear clamped interpolation
      const [inMin, inMax] = inputRange;
      const [outMin, outMax] = outputRange;
      const t = Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
      return outMin + t * (outMax - outMin);
    },
    Extrapolation: { CLAMP: "clamp" },
    runOnJS:
      (fn: (...args: unknown[]) => void) =>
      (...args: unknown[]) =>
        fn(...args),
  };
});

describe("useScrollLinkedHeader", () => {
  it("returns scrollHandler, headerAnimatedStyle, and collapsedBarAnimatedStyle", () => {
    const { result } = renderHook(() =>
      useScrollLinkedHeader({
        expandedHeight: 100,
        collapsedHeight: 44,
        collapseThreshold: 80,
        reducedMotion: false,
      }),
    );

    expect(result.current.scrollHandler).toBeDefined();
    expect(result.current.headerAnimatedStyle).toBeDefined();
    expect(result.current.collapsedBarAnimatedStyle).toBeDefined();
    expect(result.current.scrollY).toBeDefined();
  });

  it("returns expanded height and full opacity at scroll 0", () => {
    const { result } = renderHook(() =>
      useScrollLinkedHeader({
        expandedHeight: 100,
        collapsedHeight: 44,
        collapseThreshold: 80,
        reducedMotion: false,
      }),
    );

    // scrollY starts at 0, so header should be fully expanded
    expect(result.current.headerAnimatedStyle).toEqual({
      height: 100,
      opacity: 1,
    });
  });

  it("returns collapsed bar hidden at scroll 0", () => {
    const { result } = renderHook(() =>
      useScrollLinkedHeader({
        expandedHeight: 100,
        collapsedHeight: 44,
        collapseThreshold: 80,
        reducedMotion: false,
      }),
    );

    expect(result.current.collapsedBarAnimatedStyle).toEqual({
      opacity: 0,
    });
  });

  it("keeps header fully expanded when reducedMotion is true", () => {
    const { result } = renderHook(() =>
      useScrollLinkedHeader({
        expandedHeight: 100,
        collapsedHeight: 44,
        collapseThreshold: 80,
        reducedMotion: true,
      }),
    );

    expect(result.current.headerAnimatedStyle).toEqual({
      height: 100,
      opacity: 1,
    });
  });

  it("keeps collapsed bar hidden when reducedMotion is true", () => {
    const { result } = renderHook(() =>
      useScrollLinkedHeader({
        expandedHeight: 100,
        collapsedHeight: 44,
        collapseThreshold: 80,
        reducedMotion: true,
      }),
    );

    expect(result.current.collapsedBarAnimatedStyle).toEqual({
      opacity: 0,
    });
  });

  it("exposes scrollY shared value", () => {
    const { result } = renderHook(() =>
      useScrollLinkedHeader({
        expandedHeight: 100,
        collapsedHeight: 44,
        collapseThreshold: 80,
        reducedMotion: false,
      }),
    );

    expect(result.current.scrollY.value).toBe(0);
  });

  it("starts with isBarVisible false", () => {
    const { result } = renderHook(() =>
      useScrollLinkedHeader({
        expandedHeight: 100,
        collapsedHeight: 44,
        collapseThreshold: 80,
        reducedMotion: false,
      }),
    );

    expect(result.current.isBarVisible).toBe(false);
  });
});
