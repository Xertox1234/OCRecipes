import React, { useCallback } from "react";
import { View, Pressable, StyleSheet, AccessibilityInfo } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
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
import type { IngredientRow } from "@/hooks/useRecipeForm";

interface IngredientsSheetProps {
  data: IngredientRow[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, text: string) => void;
}

const IngredientItem = React.memo(function IngredientItem({
  item,
  index,
  total,
  onUpdate,
  onRemove,
}: {
  item: IngredientRow;
  index: number;
  total: number;
  onUpdate: (key: string, text: string) => void;
  onRemove: (key: string) => void;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handleRemove = () => {
    haptics.selection();
    onRemove(item.key);
    AccessibilityInfo.announceForAccessibility("Ingredient removed");
  };

  return (
    <View style={styles.ingredientRow}>
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
        placeholder={index === 0 ? 'e.g., "2 cups flour"' : "Add ingredient"}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={`Ingredient ${index + 1}`}
      />
      {total > 1 && (
        <Pressable
          onPress={handleRemove}
          style={styles.deleteButton}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ingredient ${item.text || index + 1}`}
        >
          <Feather name="x" size={18} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
});

function IngredientsSheetInner({
  data,
  onAdd,
  onRemove,
  onUpdate,
}: IngredientsSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handleAdd = useCallback(() => {
    haptics.selection();
    onAdd();
  }, [haptics, onAdd]);

  const renderItem = useCallback(
    ({ item, index }: { item: IngredientRow; index: number }) => (
      <IngredientItem
        item={item}
        index={index}
        total={data.length}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    ),
    [data.length, onUpdate, onRemove],
  );

  const keyExtractor = useCallback((item: IngredientRow) => item.key, []);

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
          accessibilityLabel="Add ingredient"
        >
          <Feather name="plus" size={16} color={theme.link} />
          <ThemedText style={[styles.addText, { color: theme.link }]}>
            Add ingredient
          </ThemedText>
        </Pressable>
      }
    />
  );
}

export const IngredientsSheet = React.memo(IngredientsSheetInner);

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
  },
  deleteButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
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
