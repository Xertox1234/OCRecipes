import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  AccessibilityInfo,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { StepRow } from "@/hooks/useRecipeForm";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import {
  canMoveStepDown,
  canMoveStepUp,
  shouldShowStepDelete,
} from "./instructions-step-utils";

interface InstructionsStepProps {
  steps: StepRow[];
  addStep: () => void;
  removeStep: (key: string) => void;
  updateStep: (key: string, text: string) => void;
  moveStep: (key: string, direction: "up" | "down") => void;
}

// ── Row component (memoized) ─────────────────────────────────────────────────
// Extracted + React.memo so editing one step's text doesn't re-render every
// other row. Per-item booleans (canUp/canDown/showDelete) are derived at the
// parent per-index and passed as primitive props.

interface InstructionRowViewProps {
  item: StepRow;
  index: number;
  canUp: boolean;
  canDown: boolean;
  showDelete: boolean;
  onUpdate: (key: string, text: string) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, direction: "up" | "down") => void;
}

const InstructionRowView = React.memo(function InstructionRowView({
  item,
  index,
  canUp,
  canDown,
  showDelete,
  onUpdate,
  onRemove,
  onMove,
}: InstructionRowViewProps) {
  const { theme } = useTheme();
  const isFirst = !canUp;
  const isLast = !canDown;
  const disabledColor = withOpacity(theme.textSecondary, 0.3);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[
        styles.row,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: withOpacity(theme.border, 0.5),
        },
      ]}
    >
      {/* Step number badge */}
      <View
        style={[styles.badge, { backgroundColor: theme.link }]}
        accessibilityLabel={`Step ${index + 1}`}
      >
        <Text style={[styles.badgeText, { color: theme.buttonText }]}>
          {index + 1}
        </Text>
      </View>

      {/* Step text input */}
      <TextInput
        style={[styles.rowInput, { color: theme.text }]}
        value={item.text}
        onChangeText={(text) => onUpdate(item.key, text)}
        placeholder="Describe this step…"
        placeholderTextColor={theme.textSecondary}
        multiline
        textAlignVertical="top"
        returnKeyType="default"
        accessibilityLabel={`Step ${index + 1} instruction`}
        accessibilityHint="Describe what to do in this step"
      />

      {/* Reorder and delete controls — 44x44 tap targets (WCAG 2.5.5) */}
      <View style={styles.controls}>
        <Pressable
          onPress={() => onMove(item.key, "up")}
          disabled={isFirst}
          style={styles.controlButton}
          accessibilityRole="button"
          accessibilityLabel="Move step up"
          accessibilityState={{ disabled: isFirst }}
          hitSlop={12}
        >
          <Feather
            name="chevron-up"
            size={20}
            color={isFirst ? disabledColor : theme.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={() => onMove(item.key, "down")}
          disabled={isLast}
          style={styles.controlButton}
          accessibilityRole="button"
          accessibilityLabel="Move step down"
          accessibilityState={{ disabled: isLast }}
          hitSlop={12}
        >
          <Feather
            name="chevron-down"
            size={20}
            color={isLast ? disabledColor : theme.textSecondary}
          />
        </Pressable>
        {showDelete && (
          <Pressable
            onPress={() => onRemove(item.key)}
            style={styles.controlButton}
            accessibilityRole="button"
            accessibilityLabel="Remove step"
            hitSlop={12}
          >
            <Feather name="x" size={20} color={theme.error} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
});

export default function InstructionsStep({
  steps,
  addStep,
  removeStep,
  updateStep,
  moveStep,
}: InstructionsStepProps) {
  const { theme } = useTheme();

  const handleAdd = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addStep();
  }, [addStep]);

  const handleRemove = useCallback(
    (key: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      removeStep(key);
      AccessibilityInfo.announceForAccessibility("Step removed");
    },
    [removeStep],
  );

  const handleMove = useCallback(
    (key: string, direction: "up" | "down") => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      moveStep(key, direction);
      AccessibilityInfo.announceForAccessibility(
        direction === "up" ? "Step moved up" : "Step moved down",
      );
    },
    [moveStep],
  );

  const stepCount = steps.length;
  const showDelete = useMemo(
    () => shouldShowStepDelete(stepCount),
    [stepCount],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: StepRow; index: number }) => {
      const canUp = canMoveStepUp(index);
      const canDown = canMoveStepDown(index, stepCount);
      return (
        <InstructionRowView
          item={item}
          index={index}
          canUp={canUp}
          canDown={canDown}
          showDelete={showDelete}
          onUpdate={updateStep}
          onRemove={handleRemove}
          onMove={handleMove}
        />
      );
    },
    [stepCount, showDelete, updateStep, handleRemove, handleMove],
  );

  const ListFooterComponent = useMemo(
    () => (
      <Pressable
        onPress={handleAdd}
        style={[
          styles.addRow,
          {
            borderColor: withOpacity(theme.link, 0.4),
            backgroundColor: withOpacity(theme.link, 0.04),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add step"
      >
        <Feather name="plus" size={16} color={theme.link} />
        <Text style={[styles.addText, { color: theme.link }]}>Add step…</Text>
      </Pressable>
    ),
    [handleAdd, theme.link],
  );

  return (
    <FlatList
      {...FLATLIST_DEFAULTS}
      data={steps}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      ListFooterComponent={ListFooterComponent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: Spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    minHeight: 64,
    gap: Spacing.sm,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    flexShrink: 0,
  },
  badgeText: {
    // color applied dynamically via theme.buttonText
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  rowInput: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: 15,
    paddingVertical: 2,
    minHeight: 48,
  },
  controls: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: Spacing.xs,
    paddingTop: 2,
  },
  // Tap target sized via padding + hitSlop for a 44x44 minimum (WCAG 2.5.5).
  // 20px icon + 12px horizontal padding + 12px hitSlop per side = 68x68
  // effective tap zone, with 44x44 visible hit surface. Stacked vertically
  // with `gap: Spacing.xs` (4px), three rows fit in ~140px — the row container
  // grows via `alignItems: "flex-start"` on `.row` so the multiline input
  // still flexes naturally.
  controlButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    height: 48,
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  addText: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
  },
});
