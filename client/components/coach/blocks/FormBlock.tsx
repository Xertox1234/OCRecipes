import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import type { FormBlock as FormBlockType } from "@shared/schemas/coach-form";
import { CardCheckRow } from "./write-cards/CardCheckRow";
import { CardStepper } from "./write-cards/CardStepper";
import {
  clearFormAnswers,
  formAnswersKey,
  getFormAnswers,
  setFormAnswers,
} from "./write-cards/write-card-session";
import {
  canSubmitForm,
  formAnswerMessage,
  formatFormNumber,
  initialFormAnswers,
  stepFormNumber,
  toggleFormOption,
  type FormAnswer,
} from "./form-utils";

interface Props {
  block: FormBlockType;
  /** Sends the answers as the user's next message. Takes the block key so
   *  the chat can pass one stable callback (as QuickReplies does). */
  onSubmit?: (message: string, blockKey?: string) => void;
  blockKey?: string;
  /** False once the conversation has moved on: the form shows as closed. */
  live?: boolean;
  /** A reply is on its way: the button waits. */
  busy?: boolean;
}

/**
 * The Coach's form (Coach roadmap T1): pick-one chips, tick rows and − / +
 * numbers, sent back as one message. It asks; it never saves anything.
 */
export default function FormBlock({
  block,
  onSubmit,
  blockKey,
  live = true,
  busy = false,
}: Props) {
  const { theme } = useTheme();
  // Answers in progress survive the footer-to-saved-row remount (L34).
  const answersKey = formAnswersKey(block);
  const [answers, setAnswers] = useState<FormAnswer[]>(
    () => getFormAnswers<FormAnswer>(answersKey) ?? initialFormAnswers(block),
  );
  const frame = [
    styles.card,
    { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
  ];

  if (!live) {
    const labels = block.fields.map((f) => f.label);
    return (
      <View
        style={[frame, styles.closed]}
        accessible
        accessibilityLabel={`Closed form: ${labels.join(", ")}`}
      >
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {labels.join(" · ")}
        </ThemedText>
      </View>
    );
  }

  const setAnswer = (index: number, answer: FormAnswer) => {
    const next = answers.map((a, i) => (i === index ? answer : a));
    setFormAnswers(answersKey, next);
    setAnswers(next);
  };
  const submitLabel = block.submitLabel ?? "Send answers";

  return (
    <View style={frame}>
      {block.title ? (
        <ThemedText type="body" style={styles.title} accessibilityRole="header">
          {block.title}
        </ThemedText>
      ) : null}
      {block.fields.map((field, i) => {
        const answer = answers[i];
        if (field.kind === "choice") {
          return (
            <View
              key={field.label}
              style={styles.field}
              accessibilityRole="radiogroup"
              accessibilityLabel={field.label}
            >
              {/* Hidden on Android only: the labelled group is read there,
                  and iOS drops the group's label. */}
              <ThemedText
                type="small"
                style={styles.label}
                importantForAccessibility="no"
              >
                {field.label}
              </ThemedText>
              <View style={styles.chips}>
                {field.options.map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    variant="filter"
                    selected={answer === option}
                    accessibilityRole="radio"
                    style={styles.chip}
                    // Tapping the selected chip clears the answer.
                    onPress={() =>
                      setAnswer(i, answer === option ? null : option)
                    }
                  />
                ))}
              </View>
            </View>
          );
        }
        if (field.kind === "multi_choice") {
          const ticked = Array.isArray(answer) ? answer : [];
          return (
            <View key={field.label} style={styles.field}>
              <ThemedText type="small" style={styles.label}>
                {field.label}
              </ThemedText>
              {field.options.map((option) => (
                <CardCheckRow
                  key={option}
                  label={option}
                  checked={ticked.includes(option)}
                  onToggle={() =>
                    setAnswer(
                      i,
                      toggleFormOption(field.options, ticked, option),
                    )
                  }
                />
              ))}
            </View>
          );
        }
        const value = typeof answer === "number" ? answer : field.value;
        const shown = formatFormNumber(field, value);
        return (
          <View key={field.label} style={[styles.field, styles.numberRow]}>
            <ThemedText type="small" style={[styles.label, styles.numberLabel]}>
              {field.label}
            </ThemedText>
            <CardStepper
              name={field.label}
              value={value}
              min={field.min}
              max={field.max}
              next={(v, delta) => stepFormNumber(field, v, delta)}
              display={field.unit ? `${shown} ${field.unit}` : shown}
              onChange={(next) => setAnswer(i, next)}
            />
          </View>
        );
      })}
      <Button
        onPress={() => {
          clearFormAnswers(answersKey);
          onSubmit?.(formAnswerMessage(block, answers), blockKey);
        }}
        disabled={busy || !canSubmitForm(block, answers)}
        accessibilityLabel={submitLabel}
        style={styles.submit}
      >
        {submitLabel}
      </Button>
      <ThemedText
        type="caption"
        style={[styles.hint, { color: theme.textSecondary }]}
      >
        Or type your answer.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  closed: { opacity: 0.6 },
  title: { fontWeight: "600", marginBottom: Spacing.sm },
  field: { marginBottom: Spacing.md },
  label: { fontWeight: "600", marginBottom: Spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: { minHeight: 44, justifyContent: "center" },
  numberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  numberLabel: { flex: 1, marginBottom: 0 },
  submit: { marginTop: Spacing.xs },
  hint: { textAlign: "center", marginTop: Spacing.sm },
});
