import React, { useEffect, useRef } from "react";
import {
  StyleSheet,
  AccessibilityInfo,
  Platform,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useShake } from "@/hooks/useShake";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

interface InlineErrorProps {
  message?: string | null;
  style?: StyleProp<ViewStyle>;
  /**
   * Bump on each validation reject (never on a server error) to shake the
   * message. A counter, not the message, so the same reject twice shakes
   * twice. Changing only the message never shakes, nor does mounting.
   */
  shakeKey?: number;
}

export function InlineError({ message, style, shakeKey }: InlineErrorProps) {
  const { theme } = useTheme();
  const { shake, animatedStyle } = useShake();
  const prevShakeKey = useRef(shakeKey);

  // From an effect, so on the first reject the shake starts after the commit
  // that mounts the message's view.
  useEffect(() => {
    if (shakeKey === prevShakeKey.current) return;
    prevShakeKey.current = shakeKey;
    if (shakeKey) shake();
  }, [shakeKey, shake]);

  useEffect(() => {
    if (message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.error, 0.06) },
        style,
        animatedStyle,
      ]}
    >
      <Feather
        name="alert-circle"
        size={16}
        color={theme.error}
        accessible={false}
      />
      <ThemedText
        type="small"
        style={{ color: theme.error, marginLeft: Spacing.sm, flex: 1 }}
      >
        {message}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
});
