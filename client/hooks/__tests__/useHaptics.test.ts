// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import * as Reanimated from "react-native-reanimated";

import { useHaptics } from "../useHaptics";

describe("useHaptics", () => {
  afterEach(() => {
    // restoreAllMocks() undoes spy installation. vi.clearAllMocks() in
    // test/setup.ts only clears call history.
    vi.restoreAllMocks();
  });

  it("triggers impact feedback when reduced motion is disabled", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);
    const impactSpy = vi.spyOn(Haptics, "impactAsync");

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.impact("medium" as Haptics.ImpactFeedbackStyle);
    });

    expect(impactSpy).toHaveBeenCalledWith("medium");
  });

  it("does NOT trigger impact when reduced motion is enabled", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    const impactSpy = vi.spyOn(Haptics, "impactAsync");

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.impact("medium" as Haptics.ImpactFeedbackStyle);
    });

    expect(impactSpy).not.toHaveBeenCalled();
  });

  it("triggers notification feedback when allowed", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);
    const notificationSpy = vi.spyOn(Haptics, "notificationAsync");

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.notification(
        "success" as Haptics.NotificationFeedbackType,
      );
    });

    expect(notificationSpy).toHaveBeenCalledWith("success");
  });

  it("triggers selection feedback when allowed", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);
    const selectionSpy = vi.spyOn(Haptics, "selectionAsync");

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.selection();
    });

    expect(selectionSpy).toHaveBeenCalled();
  });

  it("reports disabled flag based on reduced motion", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);

    const { result } = renderHook(() => useHaptics());

    expect(result.current.disabled).toBe(true);
  });
});
