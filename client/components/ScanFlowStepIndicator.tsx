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

interface ScanFlowStepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

const SEGMENT_HEIGHT = 3;
const SEGMENT_GAP = 6;

export function ScanFlowStepIndicator({
  currentStep,
  totalSteps,
}: ScanFlowStepIndicatorProps) {
  const { theme } = useTheme();

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: totalSteps,
        now: currentStep,
        text: `Step ${currentStep} of ${totalSteps}`,
      }}
      accessibilityLabel={`Scan flow: step ${currentStep} of ${totalSteps}`}
    >
      {Array.from({ length: totalSteps }, (_, i) => (
        <StepSegment
          key={i}
          active={i < currentStep}
          activeColor={theme.link}
          inactiveColor={theme.backgroundTertiary}
        />
      ))}
    </View>
  );
}

function StepSegment({
  active,
  activeColor,
  inactiveColor,
}: {
  active: boolean;
  activeColor: string;
  inactiveColor: string;
}) {
  const { reducedMotion } = useAccessibility();

  const animatedStyle = useAnimatedStyle(() => {
    const color = active ? activeColor : inactiveColor;
    if (reducedMotion) {
      return { backgroundColor: color };
    }
    return {
      backgroundColor: withTiming(color, contentRevealTimingConfig),
    };
  }, [active, activeColor, inactiveColor, reducedMotion]);

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
