import React from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { PressableScale } from "@/components/PressableScale";

interface Props {
  onPress: () => void;
  /** True while a turn is on its way or the mic is already open. */
  disabled?: boolean;
}

/**
 * Starts hands-free turn-taking (Coach roadmap V2). Outlined like the camera
 * button, so the solid mic beside it stays the primary action.
 */
export default function CoachHandsFreeButton({ onPress, disabled }: Props) {
  const { theme } = useTheme();
  return (
    <PressableScale
      scaleTo={0.85}
      style={[
        styles.button,
        {
          backgroundColor: theme.backgroundDefault,
          borderColor: theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Start hands-free conversation"
      accessibilityHint="The Coach listens, answers aloud, then listens again"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons
        name="headset"
        size={20}
        color={theme.link}
        accessible={false}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
