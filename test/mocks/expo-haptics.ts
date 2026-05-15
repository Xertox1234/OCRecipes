// Mock expo-haptics for tests. Prevents expo-modules-core native module resolution.
import { vi } from "vitest";

export const ImpactFeedbackStyle = {
  Light: "light" as const,
  Medium: "medium" as const,
  Heavy: "heavy" as const,
};

export const NotificationFeedbackType = {
  Success: "success" as const,
  Warning: "warning" as const,
  Error: "error" as const,
};

// vi.fn() so tests can `vi.spyOn(Haptics, "impactAsync")` to assert calls.
// Default impls are no-op resolved promises.
export const impactAsync = vi.fn(async (_style?: unknown) => {});
export const notificationAsync = vi.fn(async (_type?: unknown) => {});
export const selectionAsync = vi.fn(async () => {});
