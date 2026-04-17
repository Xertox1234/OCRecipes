import React, { useRef, useCallback } from "react";
import {
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
import type { IngredientRow } from "@/hooks/useRecipeForm";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface IngredientsStepProps {
  ingredients: IngredientRow[];
  addIngredient: () => void;
  removeIngredient: (key: string) => void;
  updateIngredient: (key: string, text: string) => void;
}

export default function IngredientsStep({
  ingredients,
  addIngredient,
  removeIngredient,
  updateIngredient,
}: IngredientsStepProps) {
  const { theme } = useTheme();
  const inputRefs = useRef<Map<string, TextInput>>(new Map());

  const handleAdd = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addIngredient();
  }, [addIngredient]);

  const handleRemove = useCallback(
    (key: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      removeIngredient(key);
      AccessibilityInfo.announceForAccessibility("Ingredient removed");
    },
    [removeIngredient],
  );

  const renderItem = useCallback(
    ({ item }: { item: IngredientRow }) => {
      const showDelete = ingredients.length > 1;
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
          {/* Purple bullet */}
          <Text style={[styles.bullet, { color: theme.link }]}>•</Text>

          {/* Ingredient input */}
          <TextInput
            ref={(ref) => {
              if (ref) {
                inputRefs.current.set(item.key, ref);
              } else {
                inputRefs.current.delete(item.key);
              }
            }}
            style={[styles.rowInput, { color: theme.text }]}
            value={item.text}
            onChangeText={(text) => updateIngredient(item.key, text)}
            placeholder="e.g. 2 cups flour"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
            accessibilityLabel="Ingredient"
            accessibilityHint="Enter an ingredient. Press return to add another."
          />

          {/* Delete button — hidden when only 1 row */}
          {showDelete && (
            <Pressable
              onPress={() => handleRemove(item.key)}
              style={styles.deleteButton}
              accessibilityRole="button"
              accessibilityLabel="Remove ingredient"
              hitSlop={8}
            >
              <Feather name="x" size={18} color={theme.error} />
            </Pressable>
          )}
        </Animated.View>
      );
    },
    [ingredients.length, theme, updateIngredient, handleAdd, handleRemove],
  );

  const ListFooterComponent = (
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
      accessibilityLabel="Add ingredient"
    >
      <Feather name="plus" size={16} color={theme.link} />
      <Text style={[styles.addText, { color: theme.link }]}>
        Add ingredient…
      </Text>
    </Pressable>
  );

  return (
    <FlatList
      data={ingredients}
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
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    minHeight: 48,
  },
  bullet: {
    fontSize: 20,
    marginRight: Spacing.sm,
    lineHeight: 24,
  },
  rowInput: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: 15,
    paddingVertical: Spacing.sm,
  },
  deleteButton: {
    paddingLeft: Spacing.sm,
    paddingVertical: Spacing.xs,
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
