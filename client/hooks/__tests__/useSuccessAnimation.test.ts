// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import * as Reanimated from "react-native-reanimated";
import * as RN from "react-native";

import { useSuccessPop } from "../useSuccessAnimation";

describe("useSuccessPop", () => {
  const originalPlatformOS = RN.Platform.OS;

  afterEach(() => {
    vi.restoreAllMocks();
    RN.Platform.OS = originalPlatformOS;
  });

  it("fires a Success notification via notificationAsync on iOS", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);
    const notificationSpy = vi.spyOn(Haptics, "notificationAsync");

    const { result } = renderHook(() => useSuccessPop());

    act(() => {
      result.current.trigger();
    });

    expect(notificationSpy).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it("still fires the haptic when reduced motion is enabled — tactile confirmation doesn't rely on motion", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    const notificationSpy = vi.spyOn(Haptics, "notificationAsync");

    const { result } = renderHook(() => useSuccessPop());

    act(() => {
      result.current.trigger();
    });

    expect(notificationSpy).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });
});

// expo-haptics' notificationAsync calls Android's Vibrator directly,
// bypassing the system "Vibration & haptics" toggle — same reason
// useHaptics.ts routes through performAndroidHapticsAsync on Android.
// useSuccessPop's haptic deliberately bypasses reducedMotion (comment at
// callsite: "tactile confirmation doesn't rely on motion"), so it can't
// simply delegate to useHaptics().notification() — that would reintroduce
// the reducedMotion gate. It needs its own Android-routing branch instead.
describe("useSuccessPop — Android routing", () => {
  const originalPlatformOS = RN.Platform.OS;

  beforeEach(() => {
    RN.Platform.OS = "android";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    RN.Platform.OS = originalPlatformOS;
  });

  it("routes the Success haptic through performAndroidHapticsAsync(Confirm) on Android", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);
    const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");
    const iosSpy = vi.spyOn(Haptics, "notificationAsync");

    const { result } = renderHook(() => useSuccessPop());

    act(() => {
      result.current.trigger();
    });

    expect(androidSpy).toHaveBeenCalledWith(Haptics.AndroidHaptics.Confirm);
    expect(iosSpy).not.toHaveBeenCalled();
  });

  it("still routes through Android on reduced motion (bypass is independent of platform)", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");

    const { result } = renderHook(() => useSuccessPop());

    act(() => {
      result.current.trigger();
    });

    expect(androidSpy).toHaveBeenCalledWith(Haptics.AndroidHaptics.Confirm);
  });

  it("does not call performAndroidHapticsAsync on iOS", () => {
    RN.Platform.OS = "ios";
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);
    const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");
    const iosSpy = vi.spyOn(Haptics, "notificationAsync");

    const { result } = renderHook(() => useSuccessPop());

    act(() => {
      result.current.trigger();
    });

    expect(iosSpy).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(androidSpy).not.toHaveBeenCalled();
  });
});
