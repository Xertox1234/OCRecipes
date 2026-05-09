import React from "react";
import {
  Pressable,
  StyleSheet,
  AccessibilityInfo,
  Platform,
  View,
  Text,
} from "react-native";
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

export default function CoachMicButton({
  isListening,
  volume,
  onPress,
}: Props) {
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const isFirstRender = React.useRef(true);

  React.useEffect(() => {
    if (isListening && !reducedMotion) {
      scale.value = 1 + volumeToScale(volume, 0.3);
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
    }
  }, [isListening, volume, reducedMotion, scale]);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
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
    <View accessibilityLiveRegion="polite">
      {/* Hidden text for Android TalkBack — announces when isListening changes */}
      <Text
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
        importantForAccessibility="yes"
        accessibilityElementsHidden={Platform.OS === "ios"}
      >
        {isListening ? "Listening" : ""}
      </Text>
      <Animated.View style={animatedStyle}>
        <Pressable
          style={[
            styles.button,
            { backgroundColor: isListening ? theme.error : theme.link },
          ]}
          onPress={onPress}
          accessibilityRole="togglebutton"
          accessibilityLabel={isListening ? "Stop listening" : "Voice input"}
          accessibilityState={{ checked: isListening }}
        >
          <Ionicons
            name={isListening ? "stop" : "mic"}
            size={18}
            color={theme.buttonText}
          />
        </Pressable>
      </Animated.View>
    </View>
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
