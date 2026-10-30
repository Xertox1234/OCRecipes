import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useMicPulse } from "@/hooks/useMicPulse";

interface VoiceLogButtonProps {
  isListening: boolean;
  volume: number;
  onPress: () => void;
  disabled?: boolean;
}

export const VoiceLogButton = React.memo(function VoiceLogButton({
  isListening,
  volume,
  onPress,
  disabled,
}: VoiceLogButtonProps) {
  const { theme } = useTheme();
  const animatedStyle = useMicPulse(isListening, volume, 0.2);

  return (
    <Animated.View style={animatedStyle} accessibilityLiveRegion="polite">
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={
          isListening ? "Listening, tap to stop" : "Start voice input"
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => [
          styles.button,
          isListening
            ? {
                backgroundColor: theme.error,
                opacity: pressed || disabled ? 0.7 : 1,
              }
            : {
                backgroundColor: "transparent",
                borderWidth: 1.5,
                borderColor: theme.border,
                opacity: pressed || disabled ? 0.7 : 1,
              },
        ]}
      >
        <Feather
          name="mic"
          size={22}
          color={isListening ? theme.buttonText : theme.textSecondary}
        />
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
});
