import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";

interface VoiceLogButtonProps {
  isRecording: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export const VoiceLogButton = React.memo(function VoiceLogButton({
  isRecording,
  onPress,
  disabled,
}: VoiceLogButtonProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  React.useEffect(() => {
    if (isRecording) {
      scale.value = withRepeat(withTiming(1.15, { duration: 600 }), -1, true);
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 200 });
    }
  }, [isRecording, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={
          isRecording ? "Stop recording" : "Start voice recording"
        }
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: isRecording ? theme.error : theme.link,
            opacity: pressed || disabled ? 0.7 : 1,
          },
        ]}
      >
        <Feather
          name={isRecording ? "mic-off" : "mic"}
          size={24}
          color={theme.buttonText}
        />
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
});
