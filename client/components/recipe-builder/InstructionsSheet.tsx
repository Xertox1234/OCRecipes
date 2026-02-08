import React, { useCallback } from "react";
import { View, Pressable, StyleSheet, AccessibilityInfo } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import { ImpactFeedbackStyle } from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { StepRow } from "@/hooks/useRecipeForm";

interface InstructionsSheetProps {
  data: StepRow[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, text: string) => void;
  onMove: (key: string, direction: "up" | "down") => void;
}

const StepItem = React.memo(function StepItem({
  item,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  item: StepRow;
  index: number;
  total: number;
  onUpdate: (key: string, text: string) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, direction: "up" | "down") => void;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handleRemove = () => {
    haptics.selection();
    onRemove(item.key);
    AccessibilityInfo.announceForAccessibility("Step removed");
  };

  const handleMove = (direction: "up" | "down") => {
    haptics.impact(ImpactFeedbackStyle.Light);
    onMove(item.key, direction);
  };

  return (
    <View
      style={[
        styles.stepCard,
        { backgroundColor: withOpacity(theme.text, 0.03) },
      ]}
    >
      <View style={styles.stepHeader}>
        {/* Step badge */}
        <View style={[styles.badge, { backgroundColor: theme.link }]}>
          <ThemedText style={[styles.badgeText, { color: theme.buttonText }]}>
            {index + 1}
          </ThemedText>
        </View>

        {/* Reorder + Delete actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => handleMove("up")}
            disabled={index === 0}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={`Move step ${index + 1} up`}
          >
            <Feather
              name="chevron-up"
              size={18}
              color={
                index === 0 ? withOpacity(theme.text, 0.2) : theme.textSecondary
              }
            />
          </Pressable>
          <Pressable
            onPress={() => handleMove("down")}
            disabled={index === total - 1}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={`Move step ${index + 1} down`}
          >
            <Feather
              name="chevron-down"
              size={18}
              color={
                index === total - 1
                  ? withOpacity(theme.text, 0.2)
                  : theme.textSecondary
              }
            />
          </Pressable>
          {total > 1 && (
            <Pressable
              onPress={handleRemove}
              style={styles.actionButton}
              accessibilityRole="button"
              accessibilityLabel={`Remove step ${index + 1}`}
            >
              <Feather name="x" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Step text input */}
      <BottomSheetTextInput
        style={[
          styles.input,
          {
            backgroundColor: withOpacity(theme.text, 0.04),
            color: theme.text,
            borderColor: withOpacity(theme.text, 0.1),
          },
        ]}
        value={item.text}
        onChangeText={(v) => onUpdate(item.key, v)}
        placeholder={
          index === 0 ? "e.g., Preheat oven to 350°F" : "Next step..."
        }
        placeholderTextColor={theme.textSecondary}
        multiline
        textAlignVertical="top"
        accessibilityLabel={`Step ${index + 1}`}
      />
    </View>
  );
});

function InstructionsSheetInner({
  data,
  onAdd,
  onRemove,
  onUpdate,
  onMove,
}: InstructionsSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handleAdd = useCallback(() => {
    haptics.selection();
    onAdd();
  }, [haptics, onAdd]);

  const renderItem = useCallback(
    ({ item, index }: { item: StepRow; index: number }) => (
      <StepItem
        item={item}
        index={index}
        total={data.length}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onMove={onMove}
      />
    ),
    [data.length, onUpdate, onRemove, onMove],
  );

  const keyExtractor = useCallback((item: StepRow) => item.key, []);

  return (
    <BottomSheetFlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      ListFooterComponent={
        <Pressable
          onPress={handleAdd}
          style={[
            styles.addButton,
            { borderColor: withOpacity(theme.text, 0.1) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Add step"
        >
          <Feather name="plus" size={16} color={theme.link} />
          <ThemedText style={[styles.addText, { color: theme.link }]}>
            Add step
          </ThemedText>
        </Pressable>
      }
    />
  );
}

export const InstructionsSheet = React.memo(InstructionsSheetInner);

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
  },
  stepCard: {
    borderRadius: BorderRadius.xs,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  actionButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    minHeight: 60,
    maxHeight: 120,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  addText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
});
