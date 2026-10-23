import React, { useEffect } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { useAccessibility } from "@/hooks/useAccessibility";
import { AbsoluteFill } from "@/constants/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ProgressRingProps {
  size: number;
  strokeWidth: number;
  /** 0 to 1 */
  progress: number;
  trackColor: string;
  strokeColor: string;
  children?: React.ReactNode;
}

export const ProgressRing = React.memo(function ProgressRing({
  size,
  strokeWidth,
  progress,
  trackColor,
  strokeColor,
  children,
}: ProgressRingProps) {
  const { reducedMotion } = useAccessibility();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const animatedProgress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(animatedProgress);
      animatedProgress.value = Math.min(progress, 1);
    } else {
      animatedProgress.value = withTiming(Math.min(progress, 1), {
        duration: 800,
        easing: Easing.out(Easing.cubic),
      });
    }

    return () => cancelAnimation(animatedProgress);
  }, [progress, reducedMotion, animatedProgress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animatedProgress.value),
  }));

  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children && (
        <View style={AbsoluteFill} pointerEvents="none">
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            {children}
          </View>
        </View>
      )}
    </View>
  );
});
