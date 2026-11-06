import React from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { ProgressSegment } from "./ProgressSegment";

interface OnboardingProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

const SEGMENT_GAP = 4;

export function OnboardingProgressBar({
  currentStep,
  totalSteps,
}: OnboardingProgressBarProps) {
  const { theme } = useTheme();
  // currentStep < 0 means the intro screens, before the first question.
  const stepText =
    currentStep < 0
      ? "Getting started"
      : `Step ${currentStep + 1} of ${totalSteps}`;
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: totalSteps,
        now: currentStep + 1,
        text: stepText,
      }}
      accessibilityLabel={
        currentStep < 0
          ? "Onboarding progress: getting started"
          : `Onboarding progress: step ${currentStep + 1} of ${totalSteps}`
      }
    >
      {Array.from({ length: totalSteps }, (_, i) => (
        <ProgressSegment
          key={i}
          filled={i <= currentStep}
          filledColor={theme.accentSolid}
          unfilledColor={theme.backgroundTertiary}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: SEGMENT_GAP,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
});
