import React from "react";
import {
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
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { PressableScale } from "@/components/PressableScale";
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
  const haptics = useHaptics();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const prevListeningRef = React.useRef(isListening);

  React.useEffect(() => {
    if (isListening && !reducedMotion) {
      scale.value = 1 + volumeToScale(volume, 0.3);
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
    }
  }, [isListening, volume, reducedMotion, scale]);

  React.useEffect(() => {
    // Only a real start/stop transition: skips mount and any re-run
    // caused by another dependency changing identity.
    if (prevListeningRef.current === isListening) return;
    prevListeningRef.current = isListening;
    // Keyed on the state, not the press: a start that never happens
    // (permission denied) stays silent, and an automatic stop at the end
    // of speech still gets its "got it" tick.
    haptics.impact(
      isListening
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        isListening ? "Listening" : "Stopped listening",
      );
    }
  }, [isListening, haptics]);

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
        <PressableScale
          scaleTo={0.85}
          style={[
            styles.button,
            { backgroundColor: isListening ? theme.error : theme.accentSolid },
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
            accessible={false}
          />
        </PressableScale>
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
