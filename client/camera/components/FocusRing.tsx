import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
} from "react-native-reanimated";
import type { FocusPoint } from "../hooks/useCameraFocusAndZoom";

interface Props {
  point: FocusPoint | null;
  reducedMotion: boolean;
}

const RING_SIZE = 72;

export function FocusRing({ point, reducedMotion }: Props) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1.3);

  useEffect(() => {
    if (!point) return;
    if (reducedMotion) {
      opacity.value = 1;
      scale.value = 1;
      const timeout = setTimeout(() => {
        opacity.value = 0;
      }, 600);
      return () => clearTimeout(timeout);
    }
    opacity.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(500, withTiming(0, { duration: 400 })),
    );
    scale.value = 1.3;
    scale.value = withTiming(1, { duration: 250 });
  }, [point, opacity, scale, reducedMotion]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!point) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        animStyle,
        { left: point.x - RING_SIZE / 2, top: point.y - RING_SIZE / 2 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: "#FFD60A", // hardcoded — camera overlay, matches iOS native focus-ring yellow
  },
});
