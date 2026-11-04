import React, { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";

interface FeatureTipProps {
  text: string;
  visible: boolean;
  onDismiss: () => void;
  /** Which way the little pointer faces: toward the control the tip is about. */
  pointer: "up" | "down";
  /** Which end of the bubble the pointer sits at (default: the end). */
  pointerAlign?: "start" | "end";
  /** Position it next to its control; the parent decides where. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const POINTER = 10;

/**
 * A small callout that points at a control once, to teach a faster way (camera,
 * import). Presentational: `useFeatureTip` decides whether it shows.
 */
export function FeatureTip({
  text,
  visible,
  onDismiss,
  pointer,
  pointerAlign = "end",
  style,
  testID,
}: FeatureTipProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const wasVisible = useRef(false);

  // No live region here, so announce imperatively on both platforms — once,
  // when the tip appears.
  useEffect(() => {
    if (visible && !wasVisible.current) {
      AccessibilityInfo.announceForAccessibility(`Tip: ${text}`);
    }
    wasVisible.current = visible;
  }, [visible, text]);

  if (!visible) return null;

  const pointerStyle = [
    styles.pointer,
    { backgroundColor: theme.backgroundSecondary, borderColor: theme.border },
    pointer === "up" ? styles.pointerUp : styles.pointerDown,
    pointerAlign === "start" ? styles.pointerStart : styles.pointerEnd,
  ];

  return (
    <Animated.View
      testID={testID}
      entering={reducedMotion ? undefined : FadeIn.duration(180)}
      exiting={reducedMotion ? undefined : FadeOut.duration(120)}
      style={[styles.wrapper, style]}
    >
      {pointer === "up" ? <View style={pointerStyle} /> : null}
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.border,
            shadowColor: theme.text,
          },
        ]}
      >
        <ThemedText style={[styles.text, { color: theme.text }]}>
          {text}
        </ThemedText>
        <Pressable
          onPress={onDismiss}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Dismiss tip"
          style={styles.close}
        >
          <Feather
            name="x"
            size={16}
            color={theme.textSecondary}
            accessible={false}
          />
        </Pressable>
      </View>
      {pointer === "down" ? <View style={pointerStyle} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    maxWidth: 260,
  },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    borderRadius: BorderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  text: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  close: {
    padding: Spacing.xs,
  },
  pointer: {
    width: POINTER,
    height: POINTER,
    transform: [{ rotate: "45deg" }],
    zIndex: 1,
  },
  pointerStart: {
    alignSelf: "flex-start",
    marginLeft: Spacing.lg,
  },
  pointerEnd: {
    alignSelf: "flex-end",
    marginRight: Spacing.lg,
  },
  pointerUp: {
    marginBottom: -POINTER / 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  pointerDown: {
    marginTop: -POINTER / 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});
