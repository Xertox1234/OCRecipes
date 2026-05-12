// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
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
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(
      null as unknown as boolean,
    );

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.reducedMotion).toBe(false);
  });
});
