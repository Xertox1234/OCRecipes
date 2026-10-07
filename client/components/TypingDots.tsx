import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useAccessibility } from "@/hooks/useAccessibility";
import {
  typingDotPulseTimingConfig,
  typingDotStaggerDelay,
} from "@/constants/animations";

/** Opacity at the bottom of a pulse; the top is fully opaque. */
const PULSE_LOW_OPACITY = 0.35;

interface PulsingDotProps {
  size: number;
  color: string;
  /** Milliseconds before this dot's first pulse (staggers a row of dots). */
  delay?: number;
}

/**
 * A round dot that breathes in opacity while something is in progress.
 * Decorative: the surrounding row carries the label and live region.
 * Under reduced motion it holds still at full opacity.
 */
export function PulsingDot({ size, color, delay = 0 }: PulsingDotProps) {
  const { reducedMotion } = useAccessibility();
  const opacity = useSharedValue(1);

  // Started after mount: a shared-value write made before the first commit
  // never reaches the native view.
  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }

    opacity.value = PULSE_LOW_OPACITY;
    // Delay outside the repeat so the stagger applies once; inside, it would
    // re-apply every loop and the dots would drift into lockstep.
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, typingDotPulseTimingConfig),
          withTiming(PULSE_LOW_OPACITY, typingDotPulseTimingConfig),
        ),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(opacity);
    };
  }, [reducedMotion, delay, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

interface TypingDotsProps {
  color: string;
  /** Diameter of each dot. */
  size?: number;
}

/** Three staggered pulsing dots: the "someone is typing" indicator. */
export function TypingDots({ color, size = 6 }: TypingDotsProps) {
  return (
    <View
      style={styles.row}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {[0, 1, 2].map((i) => (
        <PulsingDot
          key={i}
          size={size}
          color={color}
          delay={i * typingDotStaggerDelay}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  dot: {
    flexShrink: 0,
  },
});
