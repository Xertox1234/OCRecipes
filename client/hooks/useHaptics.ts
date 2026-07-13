import { useCallback } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useAccessibility } from "./useAccessibility";

// impactAsync/notificationAsync/selectionAsync hit Android's Vibrator
// directly, bypassing the system "Vibration & haptics" toggle.
// performAndroidHapticsAsync routes through View.performHapticFeedback(),
// which respects it — but its AndroidHaptics enum has no 1:1 iOS mapping.
const ANDROID_IMPACT_MAP: Record<
  Haptics.ImpactFeedbackStyle,
  Haptics.AndroidHaptics
> = {
  [Haptics.ImpactFeedbackStyle.Light]: Haptics.AndroidHaptics.Virtual_Key,
  [Haptics.ImpactFeedbackStyle.Medium]: Haptics.AndroidHaptics.Context_Click,
  [Haptics.ImpactFeedbackStyle.Heavy]: Haptics.AndroidHaptics.Long_Press,
  [Haptics.ImpactFeedbackStyle.Soft]: Haptics.AndroidHaptics.Gesture_End,
  [Haptics.ImpactFeedbackStyle.Rigid]:
    Haptics.AndroidHaptics.Virtual_Key_Release,
};

// Android has no middle tier between Confirm/Reject — Warning maps to
// Long_Press (not Reject) since this app's Warning means "needs another
// step," not "failed."
const ANDROID_NOTIFICATION_MAP: Record<
  Haptics.NotificationFeedbackType,
  Haptics.AndroidHaptics
> = {
  [Haptics.NotificationFeedbackType.Success]: Haptics.AndroidHaptics.Confirm,
  [Haptics.NotificationFeedbackType.Warning]: Haptics.AndroidHaptics.Long_Press,
  [Haptics.NotificationFeedbackType.Error]: Haptics.AndroidHaptics.Reject,
};

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
      if (reducedMotion) return;
      if (Platform.OS === "android") {
        void Haptics.performAndroidHapticsAsync(ANDROID_IMPACT_MAP[style]);
      } else {
        void Haptics.impactAsync(style);
      }
    },
    [reducedMotion],
  );

  const notification = useCallback(
    (type: Haptics.NotificationFeedbackType) => {
      if (reducedMotion) return;
      if (Platform.OS === "android") {
        void Haptics.performAndroidHapticsAsync(ANDROID_NOTIFICATION_MAP[type]);
      } else {
        void Haptics.notificationAsync(type);
      }
    },
    [reducedMotion],
  );

  const selection = useCallback(() => {
    if (reducedMotion) return;
    if (Platform.OS === "android") {
      void Haptics.performAndroidHapticsAsync(
        Haptics.AndroidHaptics.Segment_Tick,
      );
    } else {
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
