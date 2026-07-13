// Mock expo-haptics for tests. Prevents expo-modules-core native module resolution.
import { vi } from "vitest";

export const ImpactFeedbackStyle = {
  Light: "light" as const,
  Medium: "medium" as const,
  Heavy: "heavy" as const,
  Soft: "soft" as const,
  Rigid: "rigid" as const,
};

export const NotificationFeedbackType = {
  Success: "success" as const,
  Warning: "warning" as const,
  Error: "error" as const,
};

export const AndroidHaptics = {
  Confirm: "confirm" as const,
  Reject: "reject" as const,
  Gesture_Start: "gesture-start" as const,
  Gesture_End: "gesture-end" as const,
  Toggle_On: "toggle-on" as const,
  Toggle_Off: "toggle-off" as const,
  Clock_Tick: "clock-tick" as const,
  Context_Click: "context-click" as const,
  Drag_Start: "drag-start" as const,
  Keyboard_Tap: "keyboard-tap" as const,
  Keyboard_Press: "keyboard-press" as const,
  Keyboard_Release: "keyboard-release" as const,
  Long_Press: "long-press" as const,
  Virtual_Key: "virtual-key" as const,
  Virtual_Key_Release: "virtual-key-release" as const,
  No_Haptics: "no-haptics" as const,
  Segment_Tick: "segment-tick" as const,
  Segment_Frequent_Tick: "segment-frequent-tick" as const,
  Text_Handle_Move: "text-handle-move" as const,
};

// vi.fn() so tests can `vi.spyOn(Haptics, "impactAsync")` to assert calls.
// Default impls are no-op resolved promises.
export const impactAsync = vi.fn(async (_style?: unknown) => {});
export const notificationAsync = vi.fn(async (_type?: unknown) => {});
export const selectionAsync = vi.fn(async () => {});
export const performAndroidHapticsAsync = vi.fn(async (_type?: unknown) => {});
