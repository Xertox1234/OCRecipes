import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View, Pressable } from "react-native";
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
import {
  MEAL_LABELS,
  type MealType,
} from "@/screens/meal-plan/meal-plan-utils";

export const ADD_ITEM_MENU_SNAP_POINTS = ["45%"];

interface AddItemMenuSheetContentProps {
  mealType: MealType | null;
  onChooseRecipe: () => void;
  onSimpleEntry: () => void;
  onImportRecipe: () => void;
}

function AddItemMenuSheetContentInner({
  mealType,
  onChooseRecipe,
  onSimpleEntry,
  onImportRecipe,
}: AddItemMenuSheetContentProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  // Guards against a near-simultaneous double-tap on two different rows: each
  // handler synchronously clears the parent's menu state and defers opening
  // the next sheet via InteractionManager, so two fast taps before the first
  // dismissal lands could otherwise present two sheets at once. The guard set
  // (isActioning.current = true, read synchronously in the row handler)
  // mirrors ConfirmationModal's isActioning.current pattern; the reset is
  // different — ConfirmationModal resets synchronously from its own dismiss
  // callback, while this component has no such callback, so the reset below
  // runs from a useEffect keyed on mealType becoming truthy (a fresh sheet
  // open). That's safe here because the read this guards (a row tap) is
  // always separated from the reset by the sheet's own open animation, so
  // the effect's one-frame post-paint lag is never observable.
  const isActioning = useRef(false);

  useEffect(() => {
    if (mealType) {
      isActioning.current = false;
    }
  }, [mealType]);

  const handleChooseRecipe = useCallback(() => {
    if (isActioning.current) return;
    isActioning.current = true;
    haptics.impact(ImpactFeedbackStyle.Light);
    onChooseRecipe();
  }, [haptics, onChooseRecipe]);

  const handleSimpleEntry = useCallback(() => {
    if (isActioning.current) return;
    isActioning.current = true;
    haptics.impact(ImpactFeedbackStyle.Light);
    onSimpleEntry();
  }, [haptics, onSimpleEntry]);

  const handleImportRecipe = useCallback(() => {
    if (isActioning.current) return;
    isActioning.current = true;
    haptics.impact(ImpactFeedbackStyle.Light);
    onImportRecipe();
  }, [haptics, onImportRecipe]);

  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";

  return (
    <View style={styles.content}>
      <View
        style={[
          styles.dragIndicator,
          { backgroundColor: withOpacity(theme.text, 0.2) },
        ]}
      />
      <ThemedText style={styles.title}>Add to {label}</ThemedText>
      <View style={styles.options}>
        <Pressable
          onPress={handleChooseRecipe}
          style={[
            styles.optionRow,
            { backgroundColor: withOpacity(theme.text, 0.04) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Choose recipe"
        >
          <Feather name="book-open" size={20} color={theme.link} />
          <View style={styles.optionText}>
            <ThemedText style={styles.optionTitle}>Choose Recipe</ThemedText>
            <ThemedText
              style={[styles.optionDesc, { color: theme.textSecondary }]}
            >
              Search your recipes or create new
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textSecondary} />
        </Pressable>
        <Pressable
          onPress={handleSimpleEntry}
          style={[
            styles.optionRow,
            { backgroundColor: withOpacity(theme.text, 0.04) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Simple entry"
        >
          <Feather name="edit-3" size={20} color={theme.link} />
          <View style={styles.optionText}>
            <ThemedText style={styles.optionTitle}>Simple Entry</ThemedText>
            <ThemedText
              style={[styles.optionDesc, { color: theme.textSecondary }]}
            >
              Type a dish name, AI estimates nutrition
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textSecondary} />
        </Pressable>
        <Pressable
          onPress={handleImportRecipe}
          style={[
            styles.optionRow,
            { backgroundColor: withOpacity(theme.text, 0.04) },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Import recipe"
        >
          <Feather name="download" size={20} color={theme.link} />
          <View style={styles.optionText}>
            <ThemedText style={styles.optionTitle}>Import Recipe</ThemedText>
            <ThemedText
              style={[styles.optionDesc, { color: theme.textSecondary }]}
            >
              From URL, photo, or clipboard
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export const AddItemMenuSheetContent = React.memo(AddItemMenuSheetContentInner);

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
    alignSelf: "flex-start",
    marginBottom: Spacing.md,
  },
  options: {
    width: "100%",
    gap: Spacing.sm,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.md,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  optionDesc: {
    fontSize: 13,
    marginTop: 2,
  },
});
