import React, { useEffect, useRef } from "react";
import { StyleSheet, View, Text, AccessibilityInfo } from "react-native";
import { FontFamily, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";

interface CoachStatusRowProps {
  statusText: string;
}

/**
 * Shared status indicator shown while the coach is thinking (before any
 * streaming text has been drained to the screen).  Used by both CoachChat
 * (full-screen) and CoachOverlayContent (modal overlay).
 */
export function CoachStatusRow({ statusText }: CoachStatusRowProps) {
  const { theme } = useTheme();
  const prevStatusRef = useRef("");

  // Announce phase changes (e.g. "Searching your data...") to iOS VoiceOver.
  // Skip the first value — the parent already announces "Coach is thinking..."
  // at stream start via announceForAccessibility.
  // accessibilityLiveRegion is Android-only, so we bridge manually here.
  useEffect(() => {
    if (
      statusText &&
      prevStatusRef.current !== "" &&
      statusText !== prevStatusRef.current
    ) {
      AccessibilityInfo.announceForAccessibility(statusText);
    }
    prevStatusRef.current = statusText;
  }, [statusText]);

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: theme.accentSolid }]} />
      <Text
        style={[styles.text, { color: theme.textSecondary }]}
        accessibilityLabel={statusText}
      >
        {statusText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9, // matches ChatBubble avatar dot column (22px dot + 9px gap)
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    flexShrink: 0,
  },
  text: {
    fontSize: 14,
    fontStyle: "italic",
    fontFamily: FontFamily.regular,
  },
});
