import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { SelectableTile } from "@/components/SelectableTile";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { FontFamily, Spacing } from "@/constants/theme";
import { contentRevealTimingConfig } from "@/constants/animations";
import { WIZARD_STEPS, type WizardStep } from "./cookbook-wizard-utils";

export const STEP_LABELS: Record<WizardStep, string> = {
  basics: "Basics",
  cover: "Cover",
  recipes: "Recipes",
  review: "Review",
};

const SEGMENT_HEIGHT = 4;
const SEGMENT_GAP = 6;
/**
 * Each label cell is a full 44pt touch target in its own right — RN clips
 * hitSlop to the parent's bounds, so a short cell can't borrow height. The
 * label sits at the cell's top so it still reads tight under its segment.
 */
const LABEL_CELL_MIN_HEIGHT = 44;

interface WizardStepBarProps {
  step: WizardStep;
  /** Index into WIZARD_STEPS of the furthest step reached. */
  furthest: number;
  onSelect: (step: WizardStep) => void;
}

/**
 * The New Cookbook wizard's progress: four segments with their labels under
 * them. Steps already reached (other than the current one) are buttons —
 * behind the current step they jump back, and steps reached earlier but
 * ahead of it (after an Edit from Review) jump forward. Steps never reached
 * are plain text until the user gets there.
 *
 * The segments row carries the progressbar semantics on its own, apart from
 * the labels row — a progressbar wrapping buttons would collapse them into
 * one node and make the jump-back buttons unreachable.
 */
export function WizardStepBar({
  step,
  furthest,
  onSelect,
}: WizardStepBarProps) {
  const { theme } = useTheme();
  const currentIndex = WIZARD_STEPS.indexOf(step);
  const now = currentIndex + 1;
  const total = WIZARD_STEPS.length;

  return (
    <View style={styles.container}>
      <View
        style={styles.row}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Cookbook progress"
        accessibilityValue={{
          min: 1,
          max: total,
          now,
          text: `Step ${now} of ${total}, ${STEP_LABELS[step]}`,
        }}
      >
        {WIZARD_STEPS.map((s, i) => (
          <StepSegment
            key={s}
            filled={i <= furthest}
            filledColor={theme.link}
            unfilledColor={theme.backgroundTertiary}
          />
        ))}
      </View>

      <View style={styles.row}>
        {WIZARD_STEPS.map((s, i) => {
          const label = STEP_LABELS[s];
          const isCurrent = s === step;
          const text = (
            <ThemedText
              numberOfLines={1}
              style={[
                styles.label,
                isCurrent
                  ? { color: theme.link, fontFamily: FontFamily.semiBold }
                  : { color: theme.textSecondary },
              ]}
            >
              {label.toUpperCase()}
            </ThemedText>
          );

          if (!isCurrent && i <= furthest) {
            return (
              <SelectableTile
                key={s}
                shape="chip"
                onPress={() => onSelect(s)}
                accessibilityRole="button"
                accessibilityLabel={
                  i < currentIndex ? `Go back to ${label}` : `Go to ${label}`
                }
                style={styles.cell}
              >
                {text}
              </SelectableTile>
            );
          }

          // Not pressable — and already spoken by the progressbar above, so
          // kept out of the accessibility tree rather than read twice.
          return (
            <View
              key={s}
              style={styles.cell}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {text}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StepSegment({
  filled,
  filledColor,
  unfilledColor,
}: {
  filled: boolean;
  filledColor: string;
  unfilledColor: string;
}) {
  const { reducedMotion } = useAccessibility();

  // Same idiom as OnboardingProgressBar: the colour fades in on reveal, and
  // reduced motion snaps it to the end value rather than dropping the change.
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
    gap: Spacing.xs / 2,
  },
  row: {
    flexDirection: "row",
    gap: SEGMENT_GAP,
  },
  segment: {
    flex: 1,
    height: SEGMENT_HEIGHT,
    borderRadius: SEGMENT_HEIGHT / 2,
  },
  cell: {
    flex: 1,
    minHeight: LABEL_CELL_MIN_HEIGHT,
    justifyContent: "flex-start",
    paddingTop: Spacing.xs,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    fontFamily: FontFamily.medium,
  },
});
