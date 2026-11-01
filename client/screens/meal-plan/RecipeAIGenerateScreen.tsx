import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FieldCounter } from "@/components/FieldCounter";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";
import { InlineMicButton } from "@/components/InlineMicButton";
import { useSpeechToText } from "@/hooks/useSpeechToText";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useBottomBudget } from "@/hooks/useBottomBudget";
import { useHaptics } from "@/hooks/useHaptics";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { focusFirstInvalid } from "@/lib/field-validation";
import { InlineError } from "@/components/InlineError";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/Card";
import { useRecipeGenerate } from "@/hooks/useRecipeGenerate";
import {
  useHeldRecipeDraft,
  usePendingGeneration,
} from "@/hooks/useGeneratedRecipeNotices";
import { openRecipeCreate } from "@/navigation/openRecipeCreate";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

type AIGenerateNavProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeAIGenerate"
>;
type AIGenerateRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeAIGenerate"
>;

const PROMPT_MIN = 3;
const PROMPT_TOO_SHORT = `Describe the recipe in at least ${PROMPT_MIN} characters.`;
const PROMPT_MAX_LENGTH = 500;

const SUGGESTION_CHIPS = [
  "Quick dinner",
  "Healthy lunch",
  "Comfort food",
  "Dessert",
  "Meal prep",
  "Snack",
];

export default function RecipeAIGenerateScreen() {
  const navigation = useNavigation<AIGenerateNavProp>();
  const route = useRoute<AIGenerateRouteProp>();
  const headerHeight = useHeaderHeight();
  const bottomBudget = useBottomBudget();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const returnToMealPlan = route.params?.returnToMealPlan;
  const queryClient = useQueryClient();
  // Generation runs in the background: `start` returns at once and the draft
  // arrives as a toast (or, if missed, the banner below).
  const { start } = useRecipeGenerate();
  const isPending = usePendingGeneration("mealPlan");
  const heldDraft = useHeldRecipeDraft();
  // Same-frame double-tap guard: `isPending` only flips after the cache write
  // reaches React.
  const tappedRef = useRef(false);

  // Generate stays pressable; a short prompt is named on leaving the field or
  // on Generate, which also moves focus to it (form-fields spec §5.1).
  const promptField = useFieldValidation((value) =>
    value.trim().length < PROMPT_MIN ? PROMPT_TOO_SHORT : null,
  );
  const prompt = promptField.value;
  const setPrompt = promptField.onChangeText;
  // Destructured, never read as `promptField.ref` in render: React Compiler
  // treats an object read through `.ref` as a ref and skips the component.
  const { ref: inputRef } = promptField;
  // The counter shows only while the prompt is focused.
  const [promptFocused, setPromptFocused] = useState(false);

  // Voice input REPLACES the prompt with the dictated words (capped at the
  // field's length).
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();
  // false once submitted/closed, so a late final result cannot refill.
  const voiceActiveRef = useRef(false);
  useEffect(() => {
    if (voiceActiveRef.current && transcript && (isListening || isFinal)) {
      setPrompt(transcript.slice(0, PROMPT_MAX_LENGTH));
    }
  }, [isListening, isFinal, transcript, setPrompt]);
  const handleVoicePress = () => {
    haptics.impact(ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      voiceActiveRef.current = true;
      void startListening();
    }
  };

  const handleChipPress = (chip: string) => {
    haptics.impact(ImpactFeedbackStyle.Light);
    setPrompt(chip);
    inputRef.current?.focus();
  };

  const handleGenerate = () => {
    const trimmed = prompt.trim();
    if (!focusFirstInvalid([promptField])) {
      haptics.notification(NotificationFeedbackType.Error);
      return;
    }
    if (tappedRef.current) return;
    tappedRef.current = true;
    requestAnimationFrame(() => {
      tappedRef.current = false;
    });

    haptics.selection();
    voiceActiveRef.current = false;
    if (isListening) stopListening();
    start(trimmed, returnToMealPlan);
    navigation.goBack();
  };

  const handleReview = useCallback(() => {
    if (heldDraft) openRecipeCreate(queryClient, heldDraft);
  }, [heldDraft, queryClient]);

  const isDisabled = isPending;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingHorizontal: Spacing.lg,
            paddingBottom: bottomBudget + Spacing.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Icon section */}
        <View style={styles.iconSection}>
          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: withOpacity(theme.badgeWarningText, 0.15),
              },
            ]}
          >
            <Feather name="zap" size={32} color={theme.badgeWarningText} />
          </View>
        </View>

        {/* A draft that landed while the toast was missed (spec §5b). */}
        {heldDraft && (
          <Card
            title="Your draft is ready"
            description="Review it to make changes and save it to your plan."
          >
            <Pressable
              onPress={handleReview}
              style={[
                styles.reviewButton,
                {
                  backgroundColor: theme.accentSolid,
                  borderRadius: BorderRadius.sm,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Review"
            >
              <ThemedText
                style={[styles.buttonText, { color: theme.buttonText }]}
              >
                Review
              </ThemedText>
            </Pressable>
          </Card>
        )}

        {/* Prompt input */}
        <FocusTextInput
          ref={inputRef}
          label="What should we make?"
          style={[
            styles.promptInput,
            {
              backgroundColor: theme.backgroundSecondary,
              color: theme.text,
              borderColor: withOpacity(theme.link, 0.25),
            },
          ]}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="e.g. chicken stir fry with vegetables, or a quick weeknight pasta"
          placeholderTextColor={theme.textSecondary}
          multiline
          autoFocus
          maxLength={PROMPT_MAX_LENGTH}
          onFocus={() => setPromptFocused(true)}
          onBlur={() => {
            setPromptFocused(false);
            promptField.onBlur();
          }}
          returnKeyType="default"
          blurOnSubmit={false}
        />
        <FieldCounter
          length={prompt.length}
          max={PROMPT_MAX_LENGTH}
          visible={promptFocused}
        />
        <View style={styles.micRow}>
          <InlineMicButton
            isListening={isListening}
            volume={volume}
            onPress={handleVoicePress}
            disabled={isDisabled}
          />
        </View>
        <InlineError message={promptField.error} style={styles.promptError} />
        <InlineError message={speechError} style={styles.promptError} />

        {/* Suggestion chips */}
        <ThemedText style={[styles.chipLabel, { color: theme.textSecondary }]}>
          Or try:
        </ThemedText>
        <View style={styles.chipsRow}>
          {SUGGESTION_CHIPS.map((chip) => (
            <Pressable
              key={chip}
              onPress={() => handleChipPress(chip)}
              style={[
                styles.chip,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: withOpacity(theme.border, 0.5),
                  borderRadius: BorderRadius.chipFilled,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={chip}
            >
              <ThemedText style={[styles.chipText, { color: theme.text }]}>
                {chip}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {/* Generate button */}
        <Pressable
          onPress={handleGenerate}
          disabled={isDisabled}
          style={[
            styles.generateButton,
            {
              backgroundColor: theme.accentSolid,
              borderRadius: BorderRadius.sm,
              opacity: isDisabled ? 0.5 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            isPending ? "A recipe is on its way" : "Generate Recipe"
          }
          accessibilityState={{ disabled: isDisabled }}
        >
          {isPending ? (
            <ThemedText
              style={[styles.buttonText, { color: theme.buttonText }]}
            >
              A recipe is on its way
            </ThemedText>
          ) : (
            <ThemedText
              style={[styles.buttonText, { color: theme.buttonText }]}
            >
              Generate Recipe
            </ThemedText>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  promptError: {
    marginTop: Spacing.sm,
  },
  micRow: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  scrollContent: {
    flexGrow: 1,
  },
  iconSection: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  promptInput: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    padding: 16,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    minHeight: 100,
    lineHeight: 22,
    marginBottom: Spacing.lg,
    textAlignVertical: "top",
  },
  chipLabel: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
    marginBottom: Spacing.sm,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  reviewButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  generateButton: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
