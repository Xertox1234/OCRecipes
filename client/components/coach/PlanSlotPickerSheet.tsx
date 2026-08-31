import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Modal,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import {
  MEAL_LABELS,
  type MealType,
} from "@/screens/meal-plan/meal-plan-utils";
import {
  buildPlanSlotDays,
  PLAN_SLOT_MEAL_TYPES,
} from "./plan-slot-picker-utils";

export interface PlanSlotPickerSheetProps {
  visible: boolean;
  recipeTitle: string;
  datesWithItems: Set<string>;
  isSubmitting: boolean;
  onConfirm: (plannedDate: string, mealType: MealType) => void;
  onDismiss: () => void;
}

/**
 * Bottom-anchored slot picker that collects a `(plannedDate, mealType)` pair
 * for "Add to Plan". Purely presentational — the caller owns fetching
 * `datesWithItems` and performing the actual save; this component only
 * reports the chosen slot via `onConfirm`.
 *
 * Uses RN's `Modal` (mirroring `UpgradeModal`'s shell), not
 * `@gorhom/bottom-sheet` — the caller (`CoachChat`) is not guaranteed to
 * render inside a `BottomSheetModalProvider`.
 */
export function PlanSlotPickerSheet({
  visible,
  recipeTitle,
  datesWithItems,
  isSubmitting,
  onConfirm,
  onDismiss,
}: PlanSlotPickerSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [days, setDays] = useState(() => buildPlanSlotDays(new Date()));
  const [selectedDate, setSelectedDate] = useState(days[0].iso);
  const [selectedMeal, setSelectedMeal] = useState<MealType | null>(null);

  // The Modal only stops rendering its CHILDREN when `visible` goes false —
  // this component itself stays mounted, so its state survives a close and
  // does not reset on its own. Recompute `days` from "now" (not the stale
  // value captured at first mount) and clear both selections on every
  // false->true transition, or a reopened sheet can silently carry over the
  // previous recipe's meal choice into a fresh confirm.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    const opened = visible && !prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!opened) {
      return;
    }
    const freshDays = buildPlanSlotDays(new Date());
    setDays(freshDays);
    setSelectedDate(freshDays[0].iso);
    setSelectedMeal(null);
  }, [visible]);

  const confirmDisabled = !selectedMeal || isSubmitting;

  const handleConfirm = () => {
    if (!selectedMeal || isSubmitting) {
      return;
    }
    onConfirm(selectedDate, selectedMeal);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
        {/* Decorative backdrop dismiss target — deliberately excluded from
            the a11y tree on both platforms (accessibilityElementsHidden +
            importantForAccessibility="no-hide-descendants") rather than
            labelled. A labelled full-screen dismissal backdrop is a known
            VoiceOver trap: focus lands on it ahead of the real content and
            activating it dismisses instead of navigating in. The visible
            "Close" button below is the screen-reader-reachable dismiss. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.container,
            {
              backgroundColor: theme.backgroundDefault,
              paddingBottom: insets.bottom + Spacing.lg,
            },
          ]}
        >
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close plan slot picker"
            hitSlop={12}
            style={styles.closeButton}
          >
            <Feather name="x" size={22} color={theme.textSecondary} />
          </Pressable>

          <ThemedText type="h3" style={styles.title}>
            {recipeTitle}
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            Pick a day and meal
          </ThemedText>

          <View style={styles.dayRow}>
            {days.map((day) => {
              const selected = day.iso === selectedDate;
              const hasItems = datesWithItems.has(day.iso);
              return (
                <Pressable
                  key={day.iso}
                  onPress={() => setSelectedDate(day.iso)}
                  accessibilityRole="button"
                  accessibilityLabel={`day-slot ${day.a11yLabel}${
                    hasItems ? ", has planned items" : ""
                  }`}
                  accessibilityState={{ selected }}
                  style={[
                    styles.dayChip,
                    {
                      backgroundColor: selected
                        ? theme.accentSolid
                        : withOpacity(theme.text, 0.05),
                    },
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{ color: selected ? theme.buttonText : theme.text }}
                  >
                    {day.initial}
                  </ThemedText>
                  <ThemedText
                    type="body"
                    style={{ color: selected ? theme.buttonText : theme.text }}
                  >
                    {day.dayOfMonth}
                  </ThemedText>
                  {hasItems ? (
                    <View
                      accessible={false}
                      style={[styles.dot, { backgroundColor: theme.link }]}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.mealRow}>
            {PLAN_SLOT_MEAL_TYPES.map((meal) => {
              const selected = meal === selectedMeal;
              return (
                <Pressable
                  key={meal}
                  onPress={() => setSelectedMeal(meal)}
                  accessibilityRole="button"
                  accessibilityLabel={MEAL_LABELS[meal]}
                  accessibilityState={{ selected }}
                  style={[
                    styles.mealChip,
                    {
                      backgroundColor: selected
                        ? theme.accentSolid
                        : withOpacity(theme.text, 0.05),
                    },
                  ]}
                >
                  <ThemedText
                    type="body"
                    style={{ color: selected ? theme.buttonText : theme.text }}
                  >
                    {MEAL_LABELS[meal]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={handleConfirm}
            disabled={confirmDisabled}
            accessibilityRole="button"
            accessibilityLabel="Add to plan"
            accessibilityState={{ disabled: confirmDisabled }}
            style={[
              styles.confirmButton,
              {
                backgroundColor: theme.accentSolid,
                opacity: confirmDisabled ? 0.5 : 1,
              },
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.buttonText} size="small" />
            ) : (
              <ThemedText
                type="body"
                style={[styles.confirmText, { color: theme.buttonText }]}
              >
                Add to Plan
              </ThemedText>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  closeButton: {
    alignSelf: "flex-end",
    padding: Spacing.xs,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {
    marginBottom: Spacing.lg,
  },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  dayChip: {
    flex: 1,
    minWidth: 44,
    minHeight: 44,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: Spacing.xs,
  },
  dot: {
    position: "absolute",
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  mealRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  mealChip: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: BorderRadius.chip,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  confirmButton: {
    minHeight: 44,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  confirmText: {
    fontWeight: "600",
  },
});
