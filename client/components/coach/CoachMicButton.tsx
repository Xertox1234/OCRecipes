import React from "react";
import { Pressable, StyleSheet, AccessibilityInfo, Platform } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
  cancelAnimation,
  useReducedMotion,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { volumeToScale } from "@/lib/volume-scale";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  isListening: boolean;
  volume: number;
  onPress: () => void;
}

export default function CoachMicButton({ isListening, volume, onPress }: Props) {
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  React.useEffect(() => {
    if (isListening && !reducedMotion) {
      scale.value = 1 + volumeToScale(volume, 0.3);
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
    }
  }, [isListening, volume, reducedMotion, scale]);

  React.useEffect(() => {
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        isListening ? "Listening" : "Stopped listening",
      );
    }
  }, [isListening]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        style={[styles.button, { backgroundColor: isListening ? theme.error : theme.link }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={isListening ? "Stop listening" : "Voice input"}
        accessibilityState={{ selected: isListening }}
      >
        <Ionicons name={isListening ? "stop" : "mic"} size={18} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
