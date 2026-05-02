import React, { useEffect, useRef } from "react";
import { StyleSheet, Platform, AccessibilityInfo } from "react-native";
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from "react-native-reanimated";

interface Props {
  message: string;
}

export function CoachHint({ message }: Props) {
  const opacity = useSharedValue(message ? 1 : 0);
  const displayedMessage = useRef(message);
  const [rendered, setRendered] = React.useState(message);

  useEffect(() => {
    if (message === displayedMessage.current) return;

    opacity.value = withTiming(0, { duration: 180 });

    const swapTimer = setTimeout(() => {
      displayedMessage.current = message;
      setRendered(message);
      opacity.value = withTiming(message ? 1 : 0, { duration: 220 });
    }, 100);

    return () => clearTimeout(swapTimer);
  }, [message, opacity]);

  useEffect(() => {
    if (message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!rendered) return null;

  return (
    <Animated.Text
      style={[styles.hint, animatedStyle]}
      accessibilityLiveRegion="polite"
    >
      {rendered}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
