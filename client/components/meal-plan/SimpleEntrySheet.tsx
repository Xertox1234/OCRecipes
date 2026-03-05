import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  Pressable,
  ActivityIndicator,
} from "react-native";
import type { TextInput } from "react-native-gesture-handler";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

import { ThemedText } from "@/components/ThemedText";
import { InlineMicButton } from "@/components/InlineMicButton";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useParseFoodText } from "@/hooks/useFoodParse";
import { useCreateMealPlanRecipe } from "@/hooks/useMealPlanRecipes";
import {
  useAddMealPlanItem,
  invalidateMealPlanItems,
} from "@/hooks/useMealPlan";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useSpeechToText } from "@/hooks/useSpeechToText";
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

const SNAP_POINTS = ["45%"];

interface SimpleEntrySheetProps {
  mealType: MealType | null;
  plannedDate: string;
  onDismiss: () => void;
}

function SimpleEntrySheetInner({
  mealType,
  plannedDate,
  onDismiss,
}: SimpleEntrySheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const queryClient = useQueryClient();
  const sheetRef = useRef<BottomSheetModal>(null);
  const inputRef = useRef<TextInput>(null);

  const [dishName, setDishName] = useState("");
  const [servings, setServings] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAddingRef = useRef(false);

  const parseFoodText = useParseFoodText();
  const createRecipe = useCreateMealPlanRecipe();
  const addItem = useAddMealPlanItem();

  const hasVoiceLogging = usePremiumFeature("voiceLogging");
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(msg);
    }
  }, []);

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (mealType) {
      sheetRef.current?.present();
      setDishName("");
      setServings(1);
      setError(null);
      setIsAdding(false);
      isAddingRef.current = false;
    } else {
      sheetRef.current?.dismiss();
      if (isListening) {
        stopListening();
      }
    }
  }, [mealType, isListening, stopListening]);

  // Auto-fill dish name from streaming transcript
  useEffect(() => {
    if (isListening && transcript) {
      setDishName(transcript);
    }
  }, [isListening, transcript]);

  // Set final transcript when recognition completes
  useEffect(() => {
    if (isFinal && transcript) {
      setDishName(transcript);
    }
  }, [isFinal, transcript]);

  // Show speech errors
  useEffect(() => {
    if (speechError) {
      showError(speechError);
    }
  }, [speechError, showError]);

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

  const handleServingsChange = useCallback(
    (delta: number) => {
      haptics.selection();
      setServings((prev) => Math.max(1, Math.min(99, prev + delta)));
    },
    [haptics],
  );

  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening, haptics]);

  const handleAdd = useCallback(async () => {
    if (!mealType || !dishName.trim() || isAddingRef.current) return;
    isAddingRef.current = true;
    setIsAdding(true);
    setError(null);

    try {
      // 1. Parse food text to get nutrition estimate
      const result = await parseFoodText.mutateAsync(dishName.trim());
      const items = result?.items;

      if (!items?.length) {
        showError("Couldn't estimate nutrition. Try a simpler description.");
        isAddingRef.current = false;
        setIsAdding(false);
        return;
      }

      // 2. Sum nutrition across all parsed items into per-serving values
      let totalCal = 0;
      let totalProtein = 0;
      let totalCarbs = 0;
      let totalFat = 0;
      for (const item of items) {
        totalCal += item.calories ?? 0;
        totalProtein += item.protein ?? 0;
        totalCarbs += item.carbs ?? 0;
        totalFat += item.fat ?? 0;
      }

      // 3. Create a slim meal plan recipe
      const recipe = await createRecipe.mutateAsync({
        title: dishName.trim(),
        sourceType: "quick_entry",
        caloriesPerServing: Math.round(totalCal).toString(),
        proteinPerServing: Math.round(totalProtein).toString(),
        carbsPerServing: Math.round(totalCarbs).toString(),
        fatPerServing: Math.round(totalFat).toString(),
        servings: 1,
      });

      // 4. Add to meal plan
      await addItem.mutateAsync({
        recipeId: recipe.id,
        plannedDate,
        mealType,
        servings,
      });

      invalidateMealPlanItems(queryClient);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      onDismiss();
    } catch {
      showError("Couldn't estimate nutrition. Try a simpler description.");
    } finally {
      isAddingRef.current = false;
      setIsAdding(false);
    }
  }, [
    mealType,
    dishName,
    servings,
    plannedDate,
    parseFoodText,
    createRecipe,
    addItem,
    queryClient,
    haptics,
    showError,
    onDismiss,
  ]);

  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";
  const canAdd = dishName.trim().length > 0 && !isAdding && !isListening;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      keyboardBehavior="fillParent"
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      onDismiss={onDismiss}
      onChange={(index) => {
        if (index === 0) {
          inputRef.current?.focus();
        }
      }}
      accessibilityViewIsModal
    >
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View
            style={[
              styles.dragIndicator,
              { backgroundColor: withOpacity(theme.text, 0.2) },
            ]}
          />
          <View style={styles.headerRow}>
            <ThemedText style={styles.headerTitle}>
              Quick add to {label}
            </ThemedText>
            <Pressable
              onPress={onDismiss}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <ThemedText style={[styles.doneText, { color: theme.link }]}>
                Done
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {/* Dish name input */}
        <View style={styles.inputContainer}>
          <View
            style={[
              styles.inputBox,
              { backgroundColor: withOpacity(theme.text, 0.05) },
            ]}
          >
            <Feather name="edit-3" size={16} color={theme.textSecondary} />
            <BottomSheetTextInput
              ref={inputRef}
              style={[styles.input, { color: theme.text }]}
              placeholder={
                isListening ? "Listening..." : "e.g. chicken stir fry"
              }
              placeholderTextColor={theme.textSecondary}
              value={dishName}
              onChangeText={(text) => {
                setDishName(text);
                if (error) setError(null);
              }}
              returnKeyType="done"
              accessibilityLabel="Dish name"
            />
            {hasVoiceLogging && (
              <InlineMicButton
                isListening={isListening}
                volume={volume}
                onPress={handleVoicePress}
                disabled={isAdding}
              />
            )}
          </View>
        </View>

        {/* Error text */}
        {error && (
          <ThemedText
            style={[styles.errorText, { color: theme.error }]}
            accessibilityLiveRegion="polite"
          >
            {error}
          </ThemedText>
        )}

        {/* Servings stepper */}
        <View style={styles.servingsRow}>
          <ThemedText
            style={[styles.servingsLabel, { color: theme.textSecondary }]}
          >
            Servings
          </ThemedText>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => handleServingsChange(-1)}
              style={[
                styles.stepperButton,
                { borderColor: withOpacity(theme.text, 0.1) },
              ]}
              hitSlop={4}
              disabled={servings <= 1}
              accessibilityRole="button"
              accessibilityLabel="Decrease servings"
            >
              <Feather
                name="minus"
                size={18}
                color={
                  servings <= 1 ? withOpacity(theme.text, 0.2) : theme.text
                }
              />
            </Pressable>
            <ThemedText
              style={[styles.stepperValue, { color: theme.text }]}
              accessibilityRole="adjustable"
              accessibilityValue={{
                min: 1,
                max: 99,
                now: servings,
                text: `${servings} servings`,
              }}
            >
              {servings}
            </ThemedText>
            <Pressable
              onPress={() => handleServingsChange(1)}
              style={[
                styles.stepperButton,
                { borderColor: withOpacity(theme.text, 0.1) },
              ]}
              hitSlop={4}
              disabled={servings >= 99}
              accessibilityRole="button"
              accessibilityLabel="Increase servings"
            >
              <Feather
                name="plus"
                size={18}
                color={
                  servings >= 99 ? withOpacity(theme.text, 0.2) : theme.text
                }
              />
            </Pressable>
          </View>
        </View>

        {/* Add button */}
        <Pressable
          onPress={handleAdd}
          disabled={!canAdd}
          style={[
            styles.addButton,
            {
              backgroundColor: canAdd
                ? theme.link
                : withOpacity(theme.text, 0.1),
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${dishName || "item"} to ${label}`}
          accessibilityState={{ disabled: !canAdd }}
        >
          {isAdding ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <ThemedText
              style={[
                styles.addButtonText,
                { color: canAdd ? theme.buttonText : theme.textSecondary },
              ]}
            >
              Add
            </ThemedText>
          )}
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}

export const SimpleEntrySheet = React.memo(SimpleEntrySheetInner);

const styles = StyleSheet.create({
  content: {
    paddingBottom: Spacing.lg,
  },
  header: {
    alignItems: "center",
    paddingTop: Spacing.sm,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  doneText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  inputContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingVertical: Spacing.sm,
  },
  errorText: {
    fontSize: 13,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  servingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  servingsLabel: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
    minWidth: 32,
    textAlign: "center",
  },
  addButton: {
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  addButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
