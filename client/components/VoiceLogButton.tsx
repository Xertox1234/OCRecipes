import React from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { volumeToScale } from "@/lib/volume-scale";

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
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);

  const isFirstRender = React.useRef(true);

  React.useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(scale);
      scale.value = 1;
      return;
    }
    if (isListening) {
      scale.value = withTiming(volumeToScale(volume, 0.2), { duration: 100 });
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [isListening, volume, scale, reducedMotion]);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        isListening ? "Listening started" : "Listening stopped",
      );
    }
  }, [isListening]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle} accessibilityLiveRegion="polite">
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={
          isListening ? "Listening, tap to stop" : "Start voice input"
        }
        accessibilityRole="button"
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
