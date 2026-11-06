import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { STEP_TEXT_LINE_HEIGHT } from "./recipe-detail-utils";

/**
 * The richer (curated) variant: a step with a detail opens it on tap or hold,
 * and a one-time hint says so.
 */
export interface ExpandableInstructions {
  /** Per-step detail, by index; a step without one is not expandable. */
  details?: (string | null)[] | null;
  expandedStep: number | null;
  onToggleStep: (index: number) => void;
  /** Show the "Hold any step for more detail" hint under the steps. */
  showHint: boolean;
}

export function RecipeInstructions({
  instructions,
  expandable,
  children,
}: {
  instructions: string[];
  expandable?: ExpandableInstructions;
  /** Rendered inside the list after the steps (e.g. Tools Required). */
  children?: React.ReactNode;
}) {
  const { theme } = useTheme();

  if (!instructions || instructions.length === 0) return null;

  const stepCardStyle = [
    styles.stepCard,
    { backgroundColor: withOpacity(theme.text, 0.04) },
  ];
  const stepCircle = (i: number) => (
    <View
      style={[styles.stepCircle, { backgroundColor: theme.accentSolid }]}
      accessible={false}
    >
      <ThemedText style={styles.stepNumber}>{i + 1}</ThemedText>
    </View>
  );

  return (
    <View
      style={styles.section}
      accessibilityRole="list"
      accessibilityLabel={`Instructions, ${instructions.length} steps`}
    >
      <ThemedText
        type="h4"
        style={styles.sectionTitle}
        accessibilityRole="header"
      >
        Instructions
      </ThemedText>
      {instructions.map((step, i) => {
        if (!expandable) {
          return (
            <View
              key={i}
              style={stepCardStyle}
              accessible
              accessibilityLabel={`Step ${i + 1} of ${instructions.length}: ${step}`}
            >
              {stepCircle(i)}
              <ThemedText style={styles.stepText}>{step}</ThemedText>
            </View>
          );
        }
        const detail = expandable.details?.[i];
        const isExpandable = !!detail;
        const isExpanded = expandable.expandedStep === i;
        return (
          <Pressable
            key={i}
            onPress={
              isExpandable ? () => expandable.onToggleStep(i) : undefined
            }
            onLongPress={
              isExpandable ? () => expandable.onToggleStep(i) : undefined
            }
            delayLongPress={300}
            style={stepCardStyle}
            accessible
            accessibilityLabel={`Step ${i + 1} of ${instructions.length}: ${step}${isExpandable ? ". Tap for more detail." : ""}`}
          >
            {stepCircle(i)}
            <View style={styles.stepBody}>
              <ThemedText style={styles.expandableStepText}>{step}</ThemedText>
              {isExpanded && detail && (
                <ThemedText style={styles.stepDetail}>{detail}</ThemedText>
              )}
            </View>
          </Pressable>
        );
      })}
      {expandable?.showHint && (
        <ThemedText style={[styles.stepHint, { color: theme.textSecondary }]}>
          Hold any step for more detail
        </ThemedText>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  stepCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
    flexShrink: 0,
  },
  stepNumber: {
    color: "#FFFFFF", // hardcoded: white on the accentSolid circle
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    // Not a plain 20: see STEP_TEXT_LINE_HEIGHT for why (QA #30).
    lineHeight: STEP_TEXT_LINE_HEIGHT,
    paddingTop: 4,
  },
  stepBody: {
    flex: 1,
  },
  // Inside stepBody (which takes the flex), the text only shrinks.
  expandableStepText: {
    flexShrink: 1,
    fontSize: 14,
    // Not a plain 20: see STEP_TEXT_LINE_HEIGHT for why (QA #30).
    lineHeight: STEP_TEXT_LINE_HEIGHT,
    paddingTop: 4,
  },
  stepDetail: {
    marginTop: 6,
    opacity: 0.75,
    fontSize: 13,
    lineHeight: 18,
  },
  stepHint: {
    fontSize: 12,
    marginTop: 4,
    fontStyle: "italic",
  },
});
