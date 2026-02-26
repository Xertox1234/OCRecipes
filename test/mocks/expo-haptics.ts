// Mock expo-haptics for tests. Prevents expo-modules-core native module resolution.
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

export const impactAsync = async () => {};
export const notificationAsync = async () => {};
export const selectionAsync = async () => {};
