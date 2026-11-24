import React from "react";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { PressableScale } from "@/components/PressableScale";

interface Props {
  onPress: () => void;
  /** True while a photo is on its way or a reply is streaming. */
  disabled?: boolean;
}

/**
 * The camera button in the Coach's message box (Coach roadmap S1). Outlined,
 * so the solid mic beside it stays the primary action.
 */
export default function CoachCameraButton({ onPress, disabled }: Props) {
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
      accessibilityLabel="Send a photo of your meal"
      accessibilityHint="Scans a barcode, or takes or chooses a photo, for the Coach to log"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name="camera" size={20} color={theme.link} accessible={false} />
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
