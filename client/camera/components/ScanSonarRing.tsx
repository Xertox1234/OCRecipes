import React, { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedProps,
  runOnJS,
} from "react-native-reanimated";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  cx: number;
  cy: number;
  onComplete: () => void;
}

export function ScanSonarRing({ cx, cy, onComplete }: Props) {
  const { width, height } = useWindowDimensions();
  const r = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    r.value = withTiming(80, { duration: 400 });
    opacity.value = withTiming(0, { duration: 400 }, (finished) => {
      if (finished) runOnJS(onComplete)();
    });
  }, [r, opacity, onComplete]);

  const animatedProps = useAnimatedProps(() => ({
    r: r.value,
    opacity: opacity.value,
  }));

  return (
    <Svg
      style={[StyleSheet.absoluteFill, { width, height }]}
      pointerEvents="none"
    >
      <AnimatedCircle
        cx={cx}
        cy={cy}
        stroke="rgba(34,197,94,0.6)"
        strokeWidth={2}
        fill="none"
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
