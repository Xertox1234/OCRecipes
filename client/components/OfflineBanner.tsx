import React, { useEffect } from "react";
import { StyleSheet, AccessibilityInfo, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { SlideInUp, SlideOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useToast } from "@/context/ToastContext";
import { useTheme } from "@/hooks/useTheme";
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
      toast.success(BACK_ONLINE_MESSAGE);
      clearWasOffline();
    }
  }, [wasOffline, isOffline, toast, clearWasOffline]);

  // Announce offline state to screen readers on iOS
  useEffect(() => {
    if (isOffline && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(OFFLINE_MESSAGE);
    }
  }, [isOffline]);

  if (!isOffline) return null;

  const entering = reducedMotion
    ? undefined
    : SlideInUp.springify().damping(20).stiffness(200);
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
      accessibilityLiveRegion="assertive"
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
  message: {
    flex: 1,
    fontFamily: FontFamily.medium,
  },
});
