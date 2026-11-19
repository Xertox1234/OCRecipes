import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type TextInputInstance,
} from "react-native";
import { useBottomSheet } from "@gorhom/bottom-sheet";
import { FocusBottomSheetTextInput } from "@/components/FocusBottomSheetTextInput";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import {
  resolvePlaceholder,
  shouldFloatLabel,
} from "@/components/text-input-utils";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/Button";
import { SheetHeader } from "@/components/sheet/SheetChrome";
import { InlineError } from "@/components/InlineError";
import { InlineMicButton } from "@/components/InlineMicButton";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { formatPlanAddSuccess } from "@/components/meal-plan/plan-add-copy";
import { useParseFoodText } from "@/hooks/useFoodParse";
import { useCreateMealPlanRecipe } from "@/hooks/useMealPlanRecipes";
import {
  useAddMealPlanItem,
  invalidateMealPlanItems,
} from "@/hooks/useMealPlan";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { ApiError } from "@/lib/api-error";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  MEAL_LABELS,
  type MealType,
} from "@/components/meal-plan/meal-plan-utils";
import { SimpleEntryReview } from "@/components/meal-plan/SimpleEntryReview";
import { SimpleEntryExtras } from "@/components/meal-plan/SimpleEntryExtras";
import {
  entryTotals,
  retryKey,
  rowAmountLabel,
  stepRow,
  suggestionsFor,
  toEntryRows,
  MAX_ROW_QUANTITY,
  type EntryRow,
} from "@/components/meal-plan/simple-entry-utils";

/** Index 0 fits the dish-name step; index 1 opens up for the review list. */
export const SIMPLE_ENTRY_SNAP_POINTS = ["45%", "88%"];
const NAME_STEP_SNAP = 0;
const REVIEW_STEP_SNAP = 1;

const ESTIMATE_ERROR =
  "Couldn't estimate nutrition. Try a simpler description.";
const ADD_ERROR = "Couldn't add it to your plan. Please try again.";
const EXTRA_ERROR = "Couldn't estimate that one. Try another.";

const DISH_LABEL = "Dish name";
const DISH_ICON_SIZE = 16;
// The input box's text starts past its left padding, the icon and the gap.
const DISH_LABEL_LEFT = Spacing.md + DISH_ICON_SIZE + Spacing.sm;

interface SimpleEntrySheetContentProps {
  mealType: MealType | null;
  plannedDate: string;
  onDismiss: () => void;
}

export interface SimpleEntrySheetContentHandle {
  focusDishNameInput: () => void;
}

function SimpleEntrySheetContentInner(
  { mealType, plannedDate, onDismiss }: SimpleEntrySheetContentProps,
  forwardedRef: React.Ref<SimpleEntrySheetContentHandle>,
) {
  const { theme } = useTheme();
  // One focus ring for the whole box, not one nested around the inner input.
  const inputBoxFocus = useFieldFocus();
  const haptics = useHaptics();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInputInstance>(null);

  useImperativeHandle(forwardedRef, () => ({
    focusDishNameInput: () => inputRef.current?.focus(),
  }));

  const [dishName, setDishName] = useState("");
  // The foods the estimate found. Null means the dish-name step.
  const [rows, setRows] = useState<EntryRow[] | null>(null);
  const [servings, setServings] = useState(1);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  // Drinks and sides: the one being estimated, its error, and the suggestions
  // already taken (the estimate may name a food differently from its chip).
  const [pendingExtra, setPendingExtra] = useState<string | null>(null);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [usedSuggestions, setUsedSuggestions] = useState<string[]>([]);
  const isBusyRef = useRef(false);
  const extraCountRef = useRef(0);
  // The recipe a failed add already created, keyed by its name and numbers, so
  // a retry adds that recipe instead of creating a second copy, and an edited
  // amount saves a fresh one.
  const createdRecipeRef = useRef<{ key: string; id: number } | null>(null);
  const { snapToIndex } = useBottomSheet();

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

  // InlineError announces the message on iOS via its own effect, so this
  // setter only needs to update state — adding an announce here would
  // double-announce on iOS. Every caller is a failure, not a validation
  // reject, so it buzzes without shaking; the mutations are silentError,
  // so nothing upstream buzzes too.
  const showError = useCallback(
    (msg: string) => {
      setError(msg);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    },
    [haptics],
  );

  // Reset state when the sheet opens for a meal type. Keyed on mealType
  // alone: listening changes must not wipe the form mid-entry.
  useEffect(() => {
    if (mealType) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the reset also clears two refs, which cannot run during render; stays an effect declared before the transcript effects so it runs before them, as before
      setDishName("");
      setRows(null);
      setServings(1);
      setError(null);
      setIsEstimating(false);
      setIsAdding(false);
      setShowUpgrade(false);
      setPendingExtra(null);
      setExtraError(null);
      setUsedSuggestions([]);
      isBusyRef.current = false;
      createdRecipeRef.current = null;
    }
  }, [mealType]);

  // Stop any in-progress voice capture when the sheet closes.
  useEffect(() => {
    if (!mealType && isListening) {
      stopListening();
    }
  }, [mealType, isListening, stopListening]);

  // Auto-fill dish name from streaming transcript
  useEffect(() => {
    if (isListening && transcript) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the speech recognizer's transcript into an editable field; must stay an effect so it runs after the open/reset effect above, as before
      setDishName(transcript);
    }
  }, [isListening, transcript]);

  // Set final transcript when recognition completes
  useEffect(() => {
    if (isFinal && transcript) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the recognizer's final transcript (re-fires on the isFinal flip even with an unchanged transcript); must stay an effect so it runs after the reset effect, as before
      setDishName(transcript);
    }
  }, [isFinal, transcript]);

  // Show speech errors
  useEffect(() => {
    if (speechError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to an error from the external speech recognizer; showError also fires a haptic, a side effect that cannot run during render
      showError(speechError);
    }
  }, [speechError, showError]);

  const handleServingsChange = (delta: 1 | -1) => {
    haptics.selection();
    setServings((prev) =>
      Math.max(1, Math.min(MAX_ROW_QUANTITY, prev + delta)),
    );
  };

  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      void startListening();
    }
  }, [isListening, startListening, stopListening, haptics]);

  // Step 1 → 2: estimate the dish and show what was counted. Nothing is
  // saved until Add.
  const handleEstimate = async () => {
    const title = dishName.trim();
    if (!mealType || !title || isBusyRef.current) return;
    isBusyRef.current = true;
    setIsEstimating(true);
    setError(null);
    // Let the keyboard go now, so the sheet is settled when the foods arrive.
    inputRef.current?.blur();
    try {
      const result = await parseFoodText.mutateAsync(title);
      const items = result?.items;
      if (!items?.length) {
        showError(ESTIMATE_ERROR);
        return;
      }
      setRows(toEntryRows(items, { isExtra: false, idPrefix: "dish" }));
      setExtraError(null);
      setUsedSuggestions([]);
      snapToIndex(REVIEW_STEP_SNAP);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PREMIUM_REQUIRED") {
        setShowUpgrade(true);
      } else {
        showError(ESTIMATE_ERROR);
      }
    } finally {
      isBusyRef.current = false;
      setIsEstimating(false);
    }
  };

  const handleEditTitle = () => {
    setRows(null);
    setError(null);
    snapToIndex(NAME_STEP_SNAP);
  };

  const handleStep = (id: string, direction: 1 | -1) => {
    const row = rows?.find((r) => r.id === id);
    if (!row) return;
    const next = stepRow(row, direction);
    // At the top of the range nothing changes, so nothing answers.
    if (next?.quantity === row.quantity) return;
    if (next) {
      haptics.selection();
      AccessibilityInfo.announceForAccessibility(
        `${row.name}, ${rowAmountLabel(next)}`,
      );
    } else {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      AccessibilityInfo.announceForAccessibility(`Removed ${row.name}`);
    }
    setRows((prev) =>
      prev
        ? prev.flatMap((r) => (r.id !== id ? [r] : next ? [next] : []))
        : prev,
    );
    if (error) setError(null);
  };

  // A drink or side: estimated like the dish, then added to the same entry.
  const handleAddExtra = async (text: string): Promise<boolean> => {
    if (isBusyRef.current || !rows) return false;
    isBusyRef.current = true;
    setPendingExtra(text);
    setExtraError(null);
    try {
      const result = await parseFoodText.mutateAsync(text);
      const items = result?.items;
      if (!items?.length) {
        setExtraError(EXTRA_ERROR);
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        return false;
      }
      extraCountRef.current += 1;
      const added = toEntryRows(items, {
        isExtra: true,
        idPrefix: `extra-${extraCountRef.current}`,
      });
      setRows((prev) => (prev ? [...prev, ...added] : prev));
      setUsedSuggestions((prev) => [...prev, text]);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      AccessibilityInfo.announceForAccessibility(`Added ${text}`);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "PREMIUM_REQUIRED") {
        setShowUpgrade(true);
      } else {
        setExtraError(EXTRA_ERROR);
        haptics.notification(Haptics.NotificationFeedbackType.Error);
      }
      return false;
    } finally {
      isBusyRef.current = false;
      setPendingExtra(null);
    }
  };

  const handleAdd = async () => {
    const title = dishName.trim();
    if (!mealType || !title || !rows?.length || isBusyRef.current) return;
    isBusyRef.current = true;
    setIsAdding(true);
    setError(null);

    const totals = entryTotals(rows);
    const key = retryKey(title, totals);
    try {
      let recipeId: number;
      if (createdRecipeRef.current?.key === key) {
        recipeId = createdRecipeRef.current.id;
      } else {
        createdRecipeRef.current = null;
        // A slim recipe: the dish name and one serving's adjusted totals.
        const recipe = await createRecipe.mutateAsync({
          title,
          sourceType: "quick_entry",
          caloriesPerServing: totals.calories.toString(),
          proteinPerServing: totals.protein.toString(),
          carbsPerServing: totals.carbs.toString(),
          fatPerServing: totals.fat.toString(),
          servings: 1,
        });
        createdRecipeRef.current = { key, id: recipe.id };
        recipeId = recipe.id;
      }

      await addItem.mutateAsync({
        recipeId,
        plannedDate,
        mealType,
        servings,
      });

      createdRecipeRef.current = null;
      invalidateMealPlanItems(queryClient);
      // The sheet closes, so confirm with a toast (fires its own Success).
      toast.success(formatPlanAddSuccess(plannedDate, mealType));
      onDismiss();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PREMIUM_REQUIRED") {
        setShowUpgrade(true);
      } else {
        showError(ADD_ERROR);
      }
    } finally {
      isBusyRef.current = false;
      setIsAdding(false);
    }
  };

  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";
  const canEstimate =
    dishName.trim().length > 0 && !isEstimating && !isListening;
  const suggestions =
    mealType && rows
      ? suggestionsFor(mealType, rows).filter(
          (name) => !usedSuggestions.includes(name),
        )
      : [];

  return (
    // accessibilityViewIsModal must live on this inner View — BottomSheetModal
    // typechecks the prop but never forwards it (verified in @gorhom/bottom-sheet
    // source), so setting it on the modal is a silent no-op. iOS-only prop;
    // traps VoiceOver focus so the screen behind the sheet is unreachable while
    // it's presented. See docs/solutions/conventions/
    // a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md.
    <View style={styles.content} accessibilityViewIsModal>
      {/* Header */}
      <SheetHeader title={`Quick add to ${label}`} onDone={onDismiss} />

      {rows ? (
        <SimpleEntryReview
          title={dishName.trim()}
          mealLabel={label}
          rows={rows}
          totals={entryTotals(rows)}
          servings={servings}
          isAdding={isAdding}
          error={error}
          onStep={handleStep}
          onServingsChange={handleServingsChange}
          onEditTitle={handleEditTitle}
          onAdd={() => void handleAdd()}
        >
          <SimpleEntryExtras
            suggestions={suggestions}
            pendingName={pendingExtra}
            error={extraError}
            onAdd={handleAddExtra}
          />
        </SimpleEntryReview>
      ) : (
        <>
          {/* Dish name input */}
          <View style={styles.inputContainer}>
            <FocusField
              focus={inputBoxFocus}
              label={DISH_LABEL}
              // Listening floats the label too, so "Listening..." can show.
              hasValue={dishName.length > 0 || isListening}
              labelLeft={DISH_LABEL_LEFT}
              style={[
                styles.inputBox,
                { backgroundColor: withOpacity(theme.text, 0.05) },
              ]}
            >
              <Feather
                name="edit-3"
                size={DISH_ICON_SIZE}
                color={theme.textSecondary}
              />
              <FocusBottomSheetTextInput
                ref={inputRef}
                focusRing={false}
                onFocus={inputBoxFocus.onFocus}
                onBlur={inputBoxFocus.onBlur}
                style={[styles.input, { color: theme.text }]}
                // The label rests where the placeholder would; it shows once floated.
                placeholder={resolvePlaceholder(
                  DISH_LABEL,
                  isListening ? "Listening..." : "e.g. chicken stir fry",
                  shouldFloatLabel(
                    inputBoxFocus.focused || isListening,
                    dishName,
                  ),
                )}
                placeholderTextColor={theme.textSecondary}
                value={dishName}
                onChangeText={(text) => {
                  setDishName(text);
                  if (error) setError(null);
                }}
                returnKeyType="done"
                editable={!isEstimating}
                onSubmitEditing={() => void handleEstimate()}
                accessibilityLabel={DISH_LABEL}
                aria-invalid={!!error}
              />
              {hasVoiceLogging && (
                <InlineMicButton
                  isListening={isListening}
                  volume={volume}
                  onPress={handleVoicePress}
                  disabled={isEstimating}
                />
              )}
            </FocusField>
          </View>

          <InlineError message={error} style={styles.errorBox} />

          <Button
            onPress={() => void handleEstimate()}
            disabled={!canEstimate}
            loading={isEstimating}
            loadingText="Estimating…"
            style={styles.estimateButton}
            accessibilityHint="Shows what we count as one serving, so you can adjust it"
          >
            Estimate
          </Button>
        </>
      )}

      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </View>
  );
}

export const SimpleEntrySheetContent = React.memo(
  React.forwardRef(SimpleEntrySheetContentInner),
);

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingBottom: Spacing.lg,
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
  // Labelled field: the value sits under the floated label's row.
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    ...LABELLED_INPUT_TEXT,
  },
  errorBox: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  estimateButton: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
});
