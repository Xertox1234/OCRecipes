import React, { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { parseDecimalInput } from "@/lib/number-input";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

const SERVINGS_MIN = 1;
const SERVINGS_MAX = 99;
const SERVINGS_ERROR = `Servings must be ${SERVINGS_MIN}–${SERVINGS_MAX}`;

interface ServingStepperChipProps {
  servingCount: number;
  isAdjusted: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetServings: (n: number) => void;
}

export function ServingStepperChip({
  servingCount,
  isAdjusted,
  onIncrement,
  onDecrement,
  onSetServings,
}: ServingStepperChipProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Submit and the blur it causes both end the edit; check the value once.
  const editEndedRef = useRef(false);

  const handleIncrement = useCallback(() => {
    haptics.impact();
    setError(null);
    onIncrement();
  }, [haptics, onIncrement]);

  const handleDecrement = useCallback(() => {
    haptics.impact();
    setError(null);
    onDecrement();
  }, [haptics, onDecrement]);

  const handleNumberPress = useCallback(() => {
    editEndedRef.current = false;
    setEditValue(String(servingCount));
    setIsEditing(true);
  }, [servingCount]);

  const handleSubmitEditing = useCallback(() => {
    if (editEndedRef.current) return;
    editEndedRef.current = true;
    setIsEditing(false);
    // An emptied field cancels the edit and keeps the current count.
    if (editValue.trim() === "") return;
    const parsed = parseDecimalInput(editValue);
    if (
      parsed !== null &&
      Number.isInteger(parsed) &&
      parsed >= SERVINGS_MIN &&
      parsed <= SERVINGS_MAX
    ) {
      setError(null);
      onSetServings(parsed);
      return;
    }
    // Refused: keep the current count and say why.
    haptics.notification(Haptics.NotificationFeedbackType.Error);
    setError(SERVINGS_ERROR);
  }, [editValue, onSetServings, haptics]);

  // The chip is the visible field while the count is being typed.
  const chipFocus = useFieldFocus({ onBlur: handleSubmitEditing });

  const pillBackground = isAdjusted
    ? withOpacity(theme.link, 0.1)
    : withOpacity(theme.text, 0.06);

  return (
    <>
      {/* The outer view keeps the adjustable semantics; the FocusField inside
        draws the pill, so the ring follows its rounded edge while typing. */}
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`${servingCount} servings`}
        accessibilityHint="Tap plus or minus to adjust servings"
        accessibilityActions={[
          { name: "increment", label: "Increase servings" },
          { name: "decrement", label: "Decrease servings" },
        ]}
        onAccessibilityAction={(event) => {
          const { actionName } = event.nativeEvent;
          if (actionName !== "increment" && actionName !== "decrement") return;
          // A new count answers a shown refusal, as a +/- tap does.
          setError(null);
          if (actionName === "increment") onIncrement();
          else onDecrement();
        }}
      >
        <FocusField
          focus={chipFocus}
          style={[styles.chip, { backgroundColor: pillBackground }]}
        >
          <Pressable
            onPress={handleDecrement}
            hitSlop={8}
            accessibilityLabel="Decrease servings"
            accessibilityRole="button"
          >
            <Feather
              name="minus"
              size={12}
              color={isAdjusted ? theme.link : theme.textSecondary}
            />
          </Pressable>

          {isEditing ? (
            <FocusTextInput
              focusRing={false}
              onFocus={chipFocus.onFocus}
              onBlur={chipFocus.onBlur}
              style={[styles.editInput, { color: theme.text }]}
              value={editValue}
              onChangeText={setEditValue}
              onSubmitEditing={handleSubmitEditing}
              keyboardType="number-pad"
              selectTextOnFocus
              autoFocus
              maxLength={2}
              accessibilityLabel="Number of servings"
            />
          ) : (
            <Pressable
              onPress={handleNumberPress}
              accessibilityLabel="Edit serving count"
              accessibilityRole="button"
            >
              <ThemedText
                style={[
                  styles.countText,
                  {
                    color: isAdjusted ? theme.link : theme.textSecondary,
                  },
                ]}
              >
                <Feather
                  name="users"
                  size={12}
                  color={isAdjusted ? theme.link : theme.textSecondary}
                />{" "}
                {servingCount}
              </ThemedText>
            </Pressable>
          )}

          <Pressable
            onPress={handleIncrement}
            hitSlop={8}
            accessibilityLabel="Increase servings"
            accessibilityRole="button"
          >
            <Feather
              name="plus"
              size={12}
              color={isAdjusted ? theme.link : theme.textSecondary}
            />
          </Pressable>
        </FocusField>
      </View>
      {/* A full-width item in the chips' wrapping row, so it sits on its own
        line under the chip without stretching the neighbouring pills. */}
      <InlineError message={error} style={styles.error} />
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  countText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  error: {
    flexBasis: "100%",
  },
  editInput: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
    minWidth: 24,
    textAlign: "center",
    padding: 0,
  },
});
