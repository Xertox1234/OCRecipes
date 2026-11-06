import React from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { useAccessibility } from "@/hooks/useAccessibility";
import { contentRevealTimingConfig } from "@/constants/animations";

const SEGMENT_HEIGHT = 4;

interface ProgressSegmentProps {
  filled: boolean;
  filledColor: string;
  unfilledColor: string;
}

/**
 * One pill of a segmented progress bar (onboarding, the cookbook wizard). The
 * colour fades in on reveal, and reduced motion snaps it to the end value
 * rather than dropping the change.
 */
export function ProgressSegment({
  filled,
  filledColor,
  unfilledColor,
}: ProgressSegmentProps) {
  const { reducedMotion } = useAccessibility();

  const animatedStyle = useAnimatedStyle(() => {
    const targetColor = filled ? filledColor : unfilledColor;
    if (reducedMotion) {
      return { backgroundColor: targetColor };
    }
    return {
      backgroundColor: withTiming(targetColor, contentRevealTimingConfig),
    };
  }, [filled, filledColor, unfilledColor, reducedMotion]);

  return <Animated.View style={[styles.segment, animatedStyle]} />;
}

const styles = StyleSheet.create({
  segment: {
    flex: 1,
    height: SEGMENT_HEIGHT,
    borderRadius: SEGMENT_HEIGHT / 2,
  },
});
