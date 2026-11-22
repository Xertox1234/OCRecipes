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
  // has a dismiss button. It has no time limit (WCAG 2.2.1): it stays until
  // dismissed or back online, and comes back on the next drop.
  const [hidden, setHidden] = useState(false);
  // Reset during render when connectivity flips, so the next drop shows the
  // banner again (React's "adjust state when a prop changes" pattern).
  const [prevOffline, setPrevOffline] = useState(isOffline);
  if (prevOffline !== isOffline) {
    setPrevOffline(isOffline);
    setHidden(false);
  }
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
    >
      {/* The wrapper is NOT accessible: it holds a dismiss button, and a
          grouped wrapper would hide that button from screen readers. The
          alert role and live region sit on the message text instead. */}
      <Feather
        name="wifi-off"
        size={16}
        color={theme.backgroundDefault}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
      <ThemedText
        type="small"
        maxScale={MAX_FONT_SCALE_CONSTRAINED}
        style={[styles.message, { color: theme.backgroundDefault }]}
        numberOfLines={1}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {OFFLINE_MESSAGE}
      </ThemedText>
      <Pressable
        onPress={() => setHidden(true)}
        style={styles.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Hide offline message"
      >
        <Feather
          name="x"
          size={16}
          color={theme.backgroundDefault}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.card,
    zIndex: 9998,
  },
  // A real 44pt box, not hitSlop: the banner row is shorter than 44pt and
  // would clip the slop. Negative margins keep the banner's own height.
  dismiss: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -Spacing.sm,
    marginRight: -Spacing.md,
  },
  message: {
    flex: 1,
    fontFamily: FontFamily.medium,
  },
});
