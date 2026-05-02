import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  withSequence,
  withTiming,
  useAnimatedStyle,
} from "react-native-reanimated";

interface Props {
  /** Increment this value to trigger a flash. Starting at 0 means no flash on mount. */
  triggerCount: number;
}

export function ScanFlashOverlay({ triggerCount }: Props) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (triggerCount === 0) return;
    opacity.value = withSequence(
      withTiming(0.4, { duration: 30 }),
      withTiming(0, { duration: 50 }),
    );
  }, [triggerCount, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, animatedStyle]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: "#FFFFFF" }, // hardcoded — shutter flash must be pure white regardless of theme
});
