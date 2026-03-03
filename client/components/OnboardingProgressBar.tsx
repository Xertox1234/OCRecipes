import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing } from "@/constants/theme";
import { contentRevealTimingConfig } from "@/constants/animations";

interface OnboardingProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

const SEGMENT_HEIGHT = 4;
const SEGMENT_GAP = 4;

export function OnboardingProgressBar({
  currentStep,
  totalSteps,
}: OnboardingProgressBarProps) {
  const { theme } = useTheme();
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: totalSteps,
        now: currentStep + 1,
        text: `Step ${currentStep + 1} of ${totalSteps}`,
      }}
      accessibilityLabel={`Onboarding progress: step ${currentStep + 1} of ${totalSteps}`}
    >
      {Array.from({ length: totalSteps }, (_, i) => (
        <ProgressSegment
          key={i}
          filled={i <= currentStep}
          filledColor={theme.link}
          unfilledColor={theme.backgroundTertiary}
        />
      ))}
    </View>
  );
}

function ProgressSegment({
  filled,
  filledColor,
  unfilledColor,
}: {
  filled: boolean;
  filledColor: string;
  unfilledColor: string;
}) {
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
  container: {
    flexDirection: "row",
    gap: SEGMENT_GAP,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  segment: {
    flex: 1,
    height: SEGMENT_HEIGHT,
    borderRadius: SEGMENT_HEIGHT / 2,
  },
});
