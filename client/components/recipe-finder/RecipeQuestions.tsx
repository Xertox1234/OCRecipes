import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import { useCardArrivalAnnouncement } from "./useCardArrivalAnnouncement";
import type {
  FinderAnswer,
  RecipeQuestionsBlock,
} from "@shared/schemas/recipe-finder";

export interface RecipeQuestionsProps {
  block: RecipeQuestionsBlock;
  /** Only the latest finder message's controls are live (spec §4). */
  isActive: boolean;
  /** Off in RecipeChef's pending bubble; its saved row announces instead. */
  announceArrival?: boolean;
  onSubmit: (answers: FinderAnswer[]) => void;
}

export const RecipeQuestions = React.memo(function RecipeQuestions({
  block,
  isActive,
  announceArrival = true,
  onSubmit,
}: RecipeQuestionsProps) {
  const { theme } = useTheme();
  // Like the offer, adjust and results cards: say that a card with choices
  // arrived, once per flow.
  useCardArrivalAnnouncement(
    `questions:${block.flow.flowId}`,
    QUESTIONS_ANNOUNCEMENT,
    { enabled: announceArrival, isActive },
  );
  const [selected, setSelected] = useState<Record<number, string | undefined>>(
    {},
  );
  // Partial answers are fine: any question left unanswered is simply omitted.
  const answers = useMemo(
    () =>
      block.questions.flatMap((q, i) => {
        const answer = selected[i];
        return answer ? [{ question: q.question, answer }] : [];
      }),
    [block.questions, selected],
  );
  const canSubmit = isActive && answers.length > 0;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      {block.questions.map((q, qi) => (
        <View
          key={q.question}
          style={styles.question}
          accessibilityRole="radiogroup"
          accessibilityLabel={q.question}
        >
          {/* The group carries this name; hidden on Android only, where the
              labelled group is already read (iOS drops the group's label). */}
          <ThemedText
            style={styles.questionText}
            importantForAccessibility="no"
          >
            {q.question}
          </ThemedText>
          <View style={styles.chips}>
            {q.options.map((option) => (
              <Chip
                key={option}
                label={option}
                variant="filter"
                selected={selected[qi] === option}
                accessibilityRole="radio"
                style={styles.chip}
                onPress={
                  isActive
                    ? () =>
                        // Tapping the selected chip clears the answer.
                        setSelected((prev) => ({
                          ...prev,
                          [qi]: prev[qi] === option ? undefined : option,
                        }))
                    : undefined
                }
              />
            ))}
          </View>
        </View>
      ))}
      <Pressable
        onPress={() => onSubmit(answers)}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Search with these"
        accessibilityState={{ disabled: !canSubmit }}
        style={[
          styles.submit,
          { backgroundColor: theme.accentSolid },
          !canSubmit && styles.inactive,
        ]}
      >
        <ThemedText style={[styles.submitText, { color: theme.buttonText }]}>
          Search with these
        </ThemedText>
      </Pressable>
      <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
        Or type your answer.
      </ThemedText>
    </View>
  );
});

const QUESTIONS_ANNOUNCEMENT =
  "Recipe questions: pick answers, then Search with these";

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  question: { gap: Spacing.xs },
  questionText: { fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: { minHeight: 44, justifyContent: "center" },
  submit: {
    minHeight: 44,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { fontWeight: "600" },
  inactive: { opacity: 0.45 },
  hint: { fontSize: 12, textAlign: "center" },
});
