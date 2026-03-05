import React from "react";
import { AccessibilityInfo, Platform, Pressable } from "react-native";
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
      scale.value = withTiming(volumeToScale(volume, 0.3), { duration: 100 });
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
