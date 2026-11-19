import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  AccessibilityInfo,
  Platform,
  Pressable,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { SlideInUp, SlideOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useToast } from "@/context/ToastContext";
import { useTheme } from "@/hooks/useTheme";
import { bannerEntrySpring } from "@/constants/animations";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  Shadows,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";

const OFFLINE_MESSAGE = "You're offline. Some features may be unavailable.";
const BACK_ONLINE_MESSAGE = "Back online";
/** How long the offline banner stays before it slides away. */
export const OFFLINE_BANNER_VISIBLE_MS = 4000;

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibility();
  const { isOffline, wasOffline, clearWasOffline } = useNetworkStatus();
  const { theme } = useTheme();
  const toast = useToast();

  // Show "Back online" toast when connectivity returns
  useEffect(() => {
    if (wasOffline && !isOffline) {
      toast.success(BACK_ONLINE_MESSAGE, { haptic: false });
      clearWasOffline();
    }
  }, [wasOffline, isOffline, toast, clearWasOffline]);

  // Announce offline state to screen readers on iOS
  useEffect(() => {
    if (isOffline && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(OFFLINE_MESSAGE);
    }
  }, [isOffline]);

  // The banner floats over every screen's top bar (back, close, Reload), so it
  // must not stay there for the whole time the device is offline: it hides
  // after a few seconds or on a tap, and comes back on the next drop.
  const [hidden, setHidden] = useState(false);
  // Reset during render when connectivity flips, so the next drop shows the
  // banner again (React's "adjust state when a prop changes" pattern).
  const [prevOffline, setPrevOffline] = useState(isOffline);
  if (prevOffline !== isOffline) {
    setPrevOffline(isOffline);
    setHidden(false);
  }
  useEffect(() => {
    if (!isOffline) return;
    const timer = setTimeout(() => setHidden(true), OFFLINE_BANNER_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [isOffline]);

  if (!isOffline || hidden) return null;

  const entering = reducedMotion
    ? undefined
    : SlideInUp.springify()
        .damping(bannerEntrySpring.damping)
        .mass(bannerEntrySpring.mass)
        .stiffness(bannerEntrySpring.stiffness);
  const exiting = reducedMotion ? undefined : SlideOutUp.duration(200);

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      style={[
        styles.container,
        Shadows.medium,
        {
          top: insets.top + Spacing.sm,
          backgroundColor: withOpacity(theme.text, 0.9),
        },
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={OFFLINE_MESSAGE}
      accessibilityHint="Double-tap to hide"
      accessibilityLiveRegion="assertive"
    >
      {/* The alert semantics stay on the grouped parent (react-native-web's
          Pressable drops accessibilityLiveRegion); a screen-reader double-tap
          activates the group's centre, which lands on this Pressable. */}
      <Pressable
        onPress={() => setHidden(true)}
        style={styles.content}
        accessible={false}
        accessibilityLabel="Hide offline message"
      >
        <Feather
          name="wifi-off"
          size={16}
          color={theme.backgroundDefault}
          accessible={false}
        />
        <ThemedText
          type="small"
          maxScale={MAX_FONT_SCALE_CONSTRAINED}
          style={[styles.message, { color: theme.backgroundDefault }]}
          numberOfLines={1}
        >
          {OFFLINE_MESSAGE}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    borderRadius: BorderRadius.card,
    zIndex: 9998,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  message: {
    flex: 1,
    fontFamily: FontFamily.medium,
  },
});
