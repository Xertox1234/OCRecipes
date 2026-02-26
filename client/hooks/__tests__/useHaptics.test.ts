// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import type * as Haptics from "expo-haptics";
import { useHaptics } from "../useHaptics";

const {
  mockUseReducedMotion,
  mockImpactAsync,
  mockNotificationAsync,
  mockSelectionAsync,
} = vi.hoisted(() => ({
  mockUseReducedMotion: vi.fn(),
  mockImpactAsync: vi.fn(),
  mockNotificationAsync: vi.fn(),
  mockSelectionAsync: vi.fn(),
}));

vi.mock("react-native-reanimated", () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

vi.mock("expo-haptics", () => ({
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  selectionAsync: () => mockSelectionAsync(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

describe("useHaptics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers impact feedback when reduced motion is disabled", () => {
    mockUseReducedMotion.mockReturnValue(false);

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.impact("medium" as Haptics.ImpactFeedbackStyle);
    });

    expect(mockImpactAsync).toHaveBeenCalledWith("medium");
  });

  it("does NOT trigger impact when reduced motion is enabled", () => {
    mockUseReducedMotion.mockReturnValue(true);

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.impact("medium" as Haptics.ImpactFeedbackStyle);
    });

    expect(mockImpactAsync).not.toHaveBeenCalled();
  });

  it("triggers notification feedback when allowed", () => {
    mockUseReducedMotion.mockReturnValue(false);

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.notification(
        "success" as Haptics.NotificationFeedbackType,
      );
    });

    expect(mockNotificationAsync).toHaveBeenCalledWith("success");
  });

  it("triggers selection feedback when allowed", () => {
    mockUseReducedMotion.mockReturnValue(false);

    const { result } = renderHook(() => useHaptics());

    act(() => {
      result.current.selection();
    });

    expect(mockSelectionAsync).toHaveBeenCalled();
  });

  it("reports disabled flag based on reduced motion", () => {
    mockUseReducedMotion.mockReturnValue(true);

    const { result } = renderHook(() => useHaptics());

    expect(result.current.disabled).toBe(true);
  });
});
