import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/**
 * Hook for accessibility preferences.
 * Provides reduced motion status and other accessibility settings.
 */
export function useAccessibility() {
  const reducedMotion = useReducedMotion();
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    return () => subscription.remove();
  }, []);

  return {
    /** Whether the user prefers reduced motion */
    reducedMotion: reducedMotion ?? false,
    /** Whether VoiceOver (iOS) or TalkBack (Android) is currently active */
    screenReaderEnabled,
  };
}
