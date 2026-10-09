// Spec 2026-10-06 §3/§4.4: the adjust card — the single doorway to generation.
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Chip } from "@/components/Chip";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { useHaptics } from "@/hooks/useHaptics";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import {
  COOKING_TIME_IDS,
  type CookingTimeId,
} from "@shared/constants/cooking-times";
import type {
  FinderAction,
  RecipeAdjustBlock,
  SpiceLevel,
} from "@shared/schemas/recipe-finder";
import {
  MAX_SERVINGS,
  MIN_SERVINGS,
  SPICE_LABELS,
  type AdjustChoicesStore,
  type AdjustState,
  avoidingAccessibilityLabel,
  buildAdjustAction,
  clampServings,
  generateLabel,
  notedText,
  servingsAfterAccessibilityAction,
  timeLabel,
} from "./recipe-offer-utils";
import { useCardArrivalAnnouncement } from "./useCardArrivalAnnouncement";

const SPICE_LEVELS = Object.keys(SPICE_LABELS) as SpiceLevel[];

export interface RecipeAdjustProps {
  block: RecipeAdjustBlock;
  /** Only the latest finder message's controls are live (spec §4). */
  isActive: boolean;
  /** False in RecipeChef's pending bubble; see RecipeResultsListProps. */
  announceArrival?: boolean;
  /** `label` is the visible user bubble and the request `content`. */
  onAction: (action: FinderAction, label: string) => void;
  /**
   * The chat screen's working choices, by flowId. The card can remount with
   * the same flow (RecipeChef's pending bubble → saved row, or a list row
   * scrolled out and back), and must not reset to the prefill when it does.
   */
  choicesStore?: AdjustChoicesStore;
}

export const RecipeAdjust = React.memo(function RecipeAdjust({
  block,
  isActive,
  announceArrival = true,
  onAction,
  choicesStore,
}: RecipeAdjustProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const flowId = block.flow.flowId;
  const [choices, setChoices] = useState<AdjustState>(
    () =>
      choicesStore?.get(flowId) ?? {
        servings: clampServings(block.prefill.servings),
        spice: block.prefill.spice,
        time: block.prefill.time,
        answers: {},
      },
  );
  const { servings, spice, time, answers } = choices;

  const updateChoices = (patch: Partial<AdjustState>) => {
    const next = { ...choices, ...patch };
    choicesStore?.set(flowId, next);
    setChoices(next);
  };
  const setServings = (n: number) => updateChoices({ servings: n });
  const setSpice = (s: SpiceLevel) => updateChoices({ spice: s });
  const setTime = (t: CookingTimeId) => updateChoices({ time: t });
  // Tapping the picked option again clears the answer.
  const toggleAnswer = (question: string, option: string) => {
    const next = { ...answers };
    if (answers[question] === option) delete next[question];
    else next[question] = option;
    updateChoices({ answers: next });
  };

  const title = block.flow.dish ?? block.flow.query.q;
  useCardArrivalAnnouncement(
    `adjust:${flowId}`,
    `Adjust ${title}, then Generate`,
    { enabled: announceArrival, isActive },
  );
  const noted = notedText(block.noted);
  const canDecrease = isActive && servings > MIN_SERVINGS;
  const canIncrease = isActive && servings < MAX_SERVINGS;

  const stepServings = (delta: number) => {
    if (!isActive) return;
    const next = clampServings(servings + delta);
    if (next === servings) return;
    haptics.selection();
    setServings(next);
  };

  const handleGenerate = () => {
    if (!isActive) return;
    const action = buildAdjustAction(block, { servings, spice, time, answers });
    onAction(action, generateLabel(action));
  };

  const handleCancel = () => {
    if (!isActive) return;
    onAction({ type: "adjust_cancel", flowId: block.flow.flowId }, "Cancel");
  };

  const labelStyle = [styles.rowLabel, { color: theme.textSecondary }];
  // A radiogroup below carries this same name. Android reads the labelled
  // group node, so the visible text would be a second read there; iOS Fabric
  // drops the group's label, so the text stays readable on iOS
  // (`importantForAccessibility` is Android-only).
  const groupLabelA11y = { importantForAccessibility: "no" } as const;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      <ThemedText style={styles.title} accessibilityRole="header">
        {title}
      </ThemedText>

      <View style={styles.row}>
        {/* The stepper below carries "Servings" — don't read it twice. */}
        <ThemedText
          style={labelStyle}
          accessible={false}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          Servings
        </ThemedText>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Servings"
          accessibilityValue={{
            min: MIN_SERVINGS,
            max: MAX_SERVINGS,
            now: servings,
            text: `${servings} servings`,
          }}
          accessibilityState={{ disabled: !isActive }}
          accessibilityActions={[
            { name: "increment", label: "More servings" },
            { name: "decrement", label: "Fewer servings" },
          ]}
          onAccessibilityAction={(event) => {
            if (!isActive) return;
            const next = servingsAfterAccessibilityAction(
              servings,
              event.nativeEvent.actionName,
            );
            if (next !== servings) setServings(next);
          }}
          style={styles.stepper}
        >
          <StepperButton
            icon="minus"
            label="Fewer servings"
            enabled={canDecrease}
            onPress={() => stepServings(-1)}
          />
          <ThemedText testID="adjust-servings" style={styles.stepperValue}>
            {servings}
          </ThemedText>
          <StepperButton
            icon="plus"
            label="More servings"
            enabled={canIncrease}
            onPress={() => stepServings(1)}
          />
        </View>
      </View>

      <View style={styles.group}>
        <ThemedText style={labelStyle} {...groupLabelA11y}>
          Spice
        </ThemedText>
        <View
          style={styles.chips}
          accessibilityRole="radiogroup"
          accessibilityLabel="Spice"
        >
          {SPICE_LEVELS.map((level) => (
            <Chip
              key={level}
              label={SPICE_LABELS[level]}
              variant="filter"
              selected={spice === level}
              accessibilityRole="radio"
              style={styles.chip}
              onPress={isActive ? () => setSpice(level) : undefined}
            />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <ThemedText style={labelStyle} {...groupLabelA11y}>
          Time
        </ThemedText>
        <View
          style={styles.chips}
          accessibilityRole="radiogroup"
          accessibilityLabel="Time"
        >
          {COOKING_TIME_IDS.map((id) => (
            <Chip
              key={id}
              label={timeLabel(id)}
              variant="filter"
              selected={time === id}
              accessibilityRole="radio"
              style={styles.chip}
              onPress={isActive ? () => setTime(id) : undefined}
            />
          ))}
        </View>
      </View>

      {block.avoiding.length > 0 ? (
        <View
          style={styles.row}
          accessible
          accessibilityLabel={avoidingAccessibilityLabel(block.avoiding)}
        >
          <View style={styles.lockLabel}>
            <ThemedText style={labelStyle}>Avoiding</ThemedText>
            <Feather
              name="lock"
              size={12}
              color={theme.textSecondary}
              accessible={false}
            />
          </View>
          <ThemedText style={styles.rowValue}>
            {block.avoiding.join(", ")}
          </ThemedText>
        </View>
      ) : null}

      {noted ? (
        <View
          style={styles.row}
          accessible
          accessibilityLabel={`Also noted: ${noted}`}
        >
          <ThemedText style={labelStyle}>Also noted</ThemedText>
          <ThemedText style={styles.rowValue}>{noted}</ThemedText>
        </View>
      ) : null}

      {block.followUps.map((q) => (
        <View
          key={q.question}
          style={styles.group}
          accessibilityRole="radiogroup"
          accessibilityLabel={q.question}
        >
          <ThemedText style={styles.question} {...groupLabelA11y}>
            {q.question}
          </ThemedText>
          <View style={styles.chips}>
            {q.options.map((option) => (
              <Chip
                key={option}
                label={option}
                variant="filter"
                selected={answers[q.question] === option}
                accessibilityRole="radio"
                style={styles.chip}
                onPress={
                  isActive ? () => toggleAnswer(q.question, option) : undefined
                }
              />
            ))}
          </View>
        </View>
      ))}

      <View style={styles.buttons}>
        <PressableScale
          onPress={handleCancel}
          disabled={!isActive}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          accessibilityState={{ disabled: !isActive }}
          style={[
            styles.button,
            { borderWidth: 1, borderColor: theme.link },
            !isActive && styles.inactive,
          ]}
        >
          <ThemedText style={[styles.buttonText, { color: theme.link }]}>
            Cancel
          </ThemedText>
        </PressableScale>
        <PressableScale
          onPress={handleGenerate}
          disabled={!isActive}
          accessibilityRole="button"
          accessibilityLabel="Generate"
          accessibilityState={{ disabled: !isActive }}
          style={[
            styles.button,
            { backgroundColor: theme.accentSolid },
            !isActive && styles.inactive,
          ]}
        >
          <ThemedText style={[styles.buttonText, { color: theme.buttonText }]}>
            Generate
          </ThemedText>
        </PressableScale>
      </View>
    </View>
  );
});

function StepperButton({
  icon,
  label,
  enabled,
  onPress,
}: {
  icon: "minus" | "plus";
  label: string;
  enabled: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  // The stepper around these is one adjustable node whose increment and
  // decrement actions do the same job. iOS already hides an accessible
  // parent's children; on Android an actionable child stays its own TalkBack
  // stop, so the buttons leave the tree there too. Taps still work.
  return (
    <PressableScale
      onPress={onPress}
      disabled={!enabled}
      scaleTo={0.95}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.stepperButton,
        { borderColor: theme.link },
        !enabled && styles.inactive,
      ]}
    >
      <Feather name={icon} size={16} color={theme.link} accessible={false} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  title: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  group: { gap: Spacing.xs },
  rowLabel: { fontSize: 13, minWidth: 72 },
  rowValue: { flex: 1, fontSize: 14 },
  lockLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minWidth: 72,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: "600",
    minWidth: 24,
    textAlign: "center",
  },
  question: { fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: { minHeight: 44, justifyContent: "center" },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 14, fontWeight: "600" },
  inactive: { opacity: 0.45 },
});
