// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import * as Reanimated from "react-native-reanimated";
import * as RN from "react-native";

import { useHaptics } from "../useHaptics";

describe("useHaptics", () => {
  const originalPlatformOS = RN.Platform.OS;

  afterEach(() => {
    // restoreAllMocks() undoes spy installation. vi.clearAllMocks() in
    // test/setup.ts only clears call history.
    vi.restoreAllMocks();
    RN.Platform.OS = originalPlatformOS;
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

// expo-haptics' impactAsync/notificationAsync/selectionAsync call Android's
// Vibrator directly, bypassing the system "Vibration & haptics" toggle.
// performAndroidHapticsAsync routes through View.performHapticFeedback(),
// which respects it — so useHaptics() branches by platform.
describe("useHaptics — Android routing", () => {
  const originalPlatformOS = RN.Platform.OS;

  beforeEach(() => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(false);
    RN.Platform.OS = "android";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    RN.Platform.OS = originalPlatformOS;
  });

  const impactCases: [Haptics.ImpactFeedbackStyle, string][] = [
    [Haptics.ImpactFeedbackStyle.Light, Haptics.AndroidHaptics.Virtual_Key],
    [Haptics.ImpactFeedbackStyle.Medium, Haptics.AndroidHaptics.Context_Click],
    [Haptics.ImpactFeedbackStyle.Heavy, Haptics.AndroidHaptics.Long_Press],
    [Haptics.ImpactFeedbackStyle.Soft, Haptics.AndroidHaptics.Gesture_End],
    [
      Haptics.ImpactFeedbackStyle.Rigid,
      Haptics.AndroidHaptics.Virtual_Key_Release,
    ],
  ];

  it.each(impactCases)(
    "maps impact(%s) to performAndroidHapticsAsync(%s) on Android",
    (style, androidType) => {
      const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");
      const iosSpy = vi.spyOn(Haptics, "impactAsync");

      const { result } = renderHook(() => useHaptics());
      act(() => {
        result.current.impact(style);
      });

      expect(androidSpy).toHaveBeenCalledWith(androidType);
      expect(iosSpy).not.toHaveBeenCalled();
    },
  );

  const notificationCases: [Haptics.NotificationFeedbackType, string][] = [
    [Haptics.NotificationFeedbackType.Success, Haptics.AndroidHaptics.Confirm],
    [
      Haptics.NotificationFeedbackType.Warning,
      Haptics.AndroidHaptics.Long_Press,
    ],
    [Haptics.NotificationFeedbackType.Error, Haptics.AndroidHaptics.Reject],
  ];

  it.each(notificationCases)(
    "maps notification(%s) to performAndroidHapticsAsync(%s) on Android",
    (type, androidType) => {
      const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");
      const iosSpy = vi.spyOn(Haptics, "notificationAsync");

      const { result } = renderHook(() => useHaptics());
      act(() => {
        result.current.notification(type);
      });

      expect(androidSpy).toHaveBeenCalledWith(androidType);
      expect(iosSpy).not.toHaveBeenCalled();
    },
  );

  it("maps selection() to performAndroidHapticsAsync(Segment_Tick) on Android", () => {
    const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");
    const iosSpy = vi.spyOn(Haptics, "selectionAsync");

    const { result } = renderHook(() => useHaptics());
    act(() => {
      result.current.selection();
    });

    expect(androidSpy).toHaveBeenCalledWith(
      Haptics.AndroidHaptics.Segment_Tick,
    );
    expect(iosSpy).not.toHaveBeenCalled();
  });

  it("does not call performAndroidHapticsAsync on iOS", () => {
    RN.Platform.OS = "ios";
    const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");
    const iosSpy = vi.spyOn(Haptics, "impactAsync");

    const { result } = renderHook(() => useHaptics());
    act(() => {
      result.current.impact(Haptics.ImpactFeedbackStyle.Medium);
    });

    expect(iosSpy).toHaveBeenCalledWith("medium");
    expect(androidSpy).not.toHaveBeenCalled();
  });

  it("still gates on reduced motion before the Android branch", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    const androidSpy = vi.spyOn(Haptics, "performAndroidHapticsAsync");

    const { result } = renderHook(() => useHaptics());
    act(() => {
      result.current.impact(Haptics.ImpactFeedbackStyle.Medium);
    });

    expect(androidSpy).not.toHaveBeenCalled();
  });
});
