import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { NotificationFeedbackType } from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";

// The one earned moment: a settled scale-in (bounce well under 0.3, mass
// written out — Reanimated 4 defaults mass to 4) plus a success haptic.
const CELEBRATION_SPRING = { damping: 20, stiffness: 200, mass: 1 };

/** The report's top card. `celebrate` plays the badge once, on first open. */
export function HeadlineCard({
  headline,
  subline,
  celebrate,
  onCelebrated,
}: {
  headline: string;
  subline?: string | null;
  celebrate: boolean;
  onCelebrated: () => void;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  // Latch the first-open decision: marking it shown refetches the report with
  // `celebrate` false, which must not unmount the badge mid-animation.
  const [play] = useState(celebrate);
  const scale = useSharedValue(play && !reducedMotion ? 0.6 : 1);
  const opacity = useSharedValue(play ? 0 : 1);

  // Fire once: onCelebrated is often an inline arrow, so the deps change
  // every render; the ref keeps the animation, haptic and mark to one run.
  const played = useRef(false);
  useEffect(() => {
    if (!play || played.current) return;
    played.current = true;
    opacity.set(withTiming(1, { duration: 220 }));
    if (!reducedMotion) scale.set(withSpring(1, CELEBRATION_SPRING));
    haptics.notification(NotificationFeedbackType.Success);
    onCelebrated();
  }, [play, reducedMotion, haptics, onCelebrated, opacity, scale]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ scale: scale.get() }],
  }));

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      accessibilityRole="header"
    >
      {play && (
        <Animated.View
          testID="weekly-celebration-badge"
          style={[
            styles.badge,
            { backgroundColor: withOpacity(theme.success, 0.12) },
            badgeStyle,
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Feather name="check" size={20} color={theme.success} />
        </Animated.View>
      )}
      <ThemedText style={styles.headline}>{headline}</ThemedText>
      {subline ? (
        <ThemedText style={styles.subline}>{subline}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headline: { fontFamily: FontFamily.bold, fontSize: 22, lineHeight: 29 },
  subline: { fontSize: 15, lineHeight: 23 },
});
