// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import * as Reanimated from "react-native-reanimated";

import { useAccessibility } from "../useAccessibility";

describe("useAccessibility", () => {
  afterEach(() => {
    // vi.clearAllMocks() in test/setup.ts only clears call history.
    // restoreAllMocks() undoes the spy installation so it doesn't leak.
    vi.restoreAllMocks();
  });

  it("returns reducedMotion false when system reports false", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.reducedMotion).toBe(false);
  });

  it("returns reducedMotion true when system reports true", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.reducedMotion).toBe(true);
  });

  it("defaults to false when useReducedMotion returns null", () => {
    // Cast: Reanimated types `useReducedMotion` as `boolean`, but the runtime
    // returns `null` on initial mount before the OS query resolves. Inject
    // null to exercise the hook's null-coalescing branch.
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(
      null as unknown as boolean,
    );

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.reducedMotion).toBe(false);
  });

  it("returns screenReaderEnabled false by default before the native query resolves", () => {
    vi.spyOn(RN.AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(
      false,
    );
    vi.spyOn(RN.AccessibilityInfo, "addEventListener").mockReturnValue({
      remove: vi.fn(),
    } as unknown as ReturnType<typeof RN.AccessibilityInfo.addEventListener>);

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.screenReaderEnabled).toBe(false);
  });

  it("updates screenReaderEnabled from the native query once it resolves", async () => {
    vi.spyOn(RN.AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(
      true,
    );
    vi.spyOn(RN.AccessibilityInfo, "addEventListener").mockReturnValue({
      remove: vi.fn(),
    } as unknown as ReturnType<typeof RN.AccessibilityInfo.addEventListener>);

    const { result } = renderHook(() => useAccessibility());

    await waitFor(() => {
      expect(result.current.screenReaderEnabled).toBe(true);
    });
  });
});
