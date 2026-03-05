import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { BottomSheetModal, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
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

const SNAP_POINTS = ["35%"];

interface AddItemMenuSheetProps {
  mealType: MealType | null;
  onChooseRecipe: () => void;
  onSimpleEntry: () => void;
  onDismiss: () => void;
}

function AddItemMenuSheetInner({
  mealType,
  onChooseRecipe,
  onSimpleEntry,
  onDismiss,
}: AddItemMenuSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const sheetRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (mealType) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [mealType]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.35}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleChooseRecipe = useCallback(() => {
    haptics.impact(ImpactFeedbackStyle.Light);
    onChooseRecipe();
  }, [haptics, onChooseRecipe]);

  const handleSimpleEntry = useCallback(() => {
    haptics.impact(ImpactFeedbackStyle.Light);
    onSimpleEntry();
  }, [haptics, onSimpleEntry]);

  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      onDismiss={onDismiss}
      accessibilityViewIsModal
    >
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
            <Feather
              name="chevron-right"
              size={16}
              color={theme.textSecondary}
            />
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
            <Feather
              name="chevron-right"
              size={16}
              color={theme.textSecondary}
            />
          </Pressable>
        </View>
      </View>
    </BottomSheetModal>
  );
}

export const AddItemMenuSheet = React.memo(AddItemMenuSheetInner);

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
