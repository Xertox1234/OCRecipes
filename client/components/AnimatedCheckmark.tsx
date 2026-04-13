import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";

import { useAccessibility } from "@/hooks/useAccessibility";
import { useTheme } from "@/hooks/useTheme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface AnimatedCheckmarkProps {
  /** Whether the checkmark animation should play */
  visible: boolean;
  /** Size of the checkmark container (default 48) */
  size?: number;
  /** Called when the animation completes (after fade-out) */
  onComplete?: () => void;
}

/**
 * Self-drawing checkmark SVG that fades in, draws, then fades out.
 * Total animation ≤300ms. Respects reducedMotion.
 */
export const AnimatedCheckmark = React.memo(function AnimatedCheckmark({
  visible,
  size = 48,
  onComplete,
}: AnimatedCheckmarkProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  // The checkmark path length (approximated for "M 6 13 L 11 18 L 20 7")
  const pathLength = 24;
  const drawProgress = useSharedValue(0);
  const containerOpacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      drawProgress.value = 0;
      containerOpacity.value = 0;
      return;
    }

    if (reducedMotion) {
      drawProgress.value = 1;
      containerOpacity.value = 1;
      // Instant show, then schedule complete
      const timer = setTimeout(() => {
        containerOpacity.value = 0;
        onComplete?.();
      }, 300);
      return () => clearTimeout(timer);
    }

    // Fade in + draw (200ms), hold briefly, then fade out (100ms)
    containerOpacity.value = withTiming(1, { duration: 100 });
    drawProgress.value = withTiming(1, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });

    // Fade out after animation completes
    const timer = setTimeout(() => {
      containerOpacity.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(0, { duration: 100 }),
      );
      setTimeout(() => onComplete?.(), 300);
    }, 300);

    return () => clearTimeout(timer);
  }, [visible, reducedMotion, drawProgress, containerOpacity, onComplete]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: pathLength * (1 - drawProgress.value),
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.container, { width: size, height: size }, containerStyle]}
      pointerEvents="none"
    >
      <Svg width={size} height={size} viewBox="0 0 26 26">
        <AnimatedPath
          d="M 6 13 L 11 18 L 20 7"
          fill="none"
          stroke={theme.success}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={pathLength}
          animatedProps={animatedProps}
        />
      </Svg>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
});
