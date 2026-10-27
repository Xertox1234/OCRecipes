import React from "react";
import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useMicPulse } from "@/hooks/useMicPulse";

interface InlineMicButtonProps {
  isListening: boolean;
  volume: number;
  onPress: () => void;
  disabled?: boolean;
}

export const InlineMicButton = React.memo(function InlineMicButton({
  isListening,
  volume,
  onPress,
  disabled,
}: InlineMicButtonProps) {
  const { theme } = useTheme();
  const animatedStyle = useMicPulse(isListening, volume, 0.3);

  const accessibilityLabel = isListening
    ? "Listening, tap to stop"
    : "Start voice input";

  return (
    <Animated.View style={animatedStyle} accessibilityLiveRegion="polite">
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hitSlop={12}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => ({
          opacity: pressed || disabled ? 0.5 : 1,
        })}
      >
        <Feather
          name="mic"
          size={20}
          color={isListening ? theme.error : theme.textSecondary}
        />
      </Pressable>
    </Animated.View>
  );
});
