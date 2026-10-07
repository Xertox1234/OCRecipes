import React from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

import { PressableScale } from "@/components/PressableScale";
import { TypingDots } from "@/components/TypingDots";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";

interface SendButtonProps {
  onPress: () => void;
  /** False dims the button and disables it. */
  canSend: boolean;
  /** A reply is on its way: shows typing dots and disables the button. */
  busy?: boolean;
  iconSize?: number;
  /** Layout only (margins); the button sizes and colours itself. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Round send button for the chat input bars. Springs on press (the 0.85
 * icon-button tier). Owns no haptic: each screen's send handler buzzes, so
 * the return key and programmatic sends share one feedback path.
 */
export function SendButton({
  onPress,
  canSend,
  busy = false,
  iconSize = 18,
  style,
}: SendButtonProps) {
  const { theme } = useTheme();
  const enabled = canSend && !busy;

  return (
    <PressableScale
      scaleTo={0.85}
      onPress={onPress}
      disabled={!enabled}
      style={[
        styles.button,
        {
          backgroundColor: enabled
            ? theme.accentSolid
            : withOpacity(theme.text, 0.12),
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Send message"
      accessibilityState={{ disabled: !enabled }}
    >
      {busy ? (
        <TypingDots color={theme.textSecondary} size={5} />
      ) : (
        <Feather
          name="send"
          size={iconSize}
          color={canSend ? theme.buttonText : theme.textSecondary}
        />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
