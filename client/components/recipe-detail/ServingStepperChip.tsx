import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

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

  const handleIncrement = useCallback(() => {
    haptics.impact();
    onIncrement();
  }, [haptics, onIncrement]);

  const handleDecrement = useCallback(() => {
    haptics.impact();
    onDecrement();
  }, [haptics, onDecrement]);

  const handleNumberPress = useCallback(() => {
    setEditValue(String(servingCount));
    setIsEditing(true);
  }, [servingCount]);

  const handleSubmitEditing = useCallback(() => {
    setIsEditing(false);
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onSetServings(Math.min(parsed, 99));
    }
    // If invalid, reverts to current servingCount (no-op)
  }, [editValue, onSetServings]);

  const pillBackground = isAdjusted
    ? withOpacity(theme.link, 0.1)
    : withOpacity(theme.text, 0.06);

  return (
    <View
      style={[styles.chip, { backgroundColor: pillBackground }]}
      accessibilityRole="adjustable"
      accessibilityLabel={`${servingCount} servings`}
      accessibilityHint="Tap plus or minus to adjust servings"
      accessibilityActions={[
        { name: "increment", label: "Increase servings" },
        { name: "decrement", label: "Decrease servings" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") onIncrement();
        if (event.nativeEvent.actionName === "decrement") onDecrement();
      }}
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
        <TextInput
          style={[styles.editInput, { color: theme.text }]}
          value={editValue}
          onChangeText={setEditValue}
          onBlur={handleSubmitEditing}
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
    </View>
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
  editInput: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
    minWidth: 24,
    textAlign: "center",
    padding: 0,
  },
});
