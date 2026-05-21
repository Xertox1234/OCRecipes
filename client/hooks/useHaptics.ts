import { useCallback } from "react";
import * as Haptics from "expo-haptics";
import { useAccessibility } from "./useAccessibility";

/**
 * Hook for haptic feedback with accessibility awareness.
 * Automatically disables haptics when reduced motion is enabled.
 */
export function useHaptics() {
  const { reducedMotion } = useAccessibility();

  const impact = useCallback(
    (
      style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
    ) => {
      if (!reducedMotion) {
        void Haptics.impactAsync(style);
      }
    },
    [reducedMotion],
  );

  const notification = useCallback(
    (type: Haptics.NotificationFeedbackType) => {
      if (!reducedMotion) {
        void Haptics.notificationAsync(type);
      }
    },
    [reducedMotion],
  );

  const selection = useCallback(() => {
    if (!reducedMotion) {
      void Haptics.selectionAsync();
    }
  }, [reducedMotion]);

  return {
    /** Trigger impact feedback */
    impact,
    /** Trigger notification feedback (success, warning, error) */
    notification,
    /** Trigger selection feedback */
    selection,
    /** Whether haptics are disabled due to reduced motion preference */
    disabled: reducedMotion,
  };
}
