import React from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";

interface InlineMicButtonProps {
  isRecording: boolean;
  isTranscribing: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export const InlineMicButton = React.memo(function InlineMicButton({
  isRecording,
  isTranscribing,
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
    if (isRecording) {
      scale.value = withRepeat(withTiming(1.15, { duration: 600 }), -1, true);
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, scale, reducedMotion]);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        isRecording ? "Recording started" : "Recording stopped",
      );
    }
  }, [isRecording]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const accessibilityLabel = isTranscribing
    ? "Transcribing voice recording"
    : isRecording
      ? "Stop recording"
      : "Start voice recording";

  return (
    <Animated.View style={animatedStyle} accessibilityLiveRegion="polite">
      <Pressable
        onPress={onPress}
        disabled={disabled || isTranscribing}
        hitSlop={12}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={({ pressed }) => ({
          opacity: pressed || disabled ? 0.5 : 1,
        })}
      >
        {isTranscribing ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : (
          <Feather
            name={isRecording ? "mic-off" : "mic"}
            size={20}
            color={isRecording ? theme.error : theme.textSecondary}
          />
        )}
      </Pressable>
    </Animated.View>
  );
});
