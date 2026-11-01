import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  AccessibilityInfo,
  View,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FocusField } from "@/components/FocusField";
import { InlineMicButton } from "@/components/InlineMicButton";
import { InlineError } from "@/components/InlineError";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useFieldFocus } from "@/components/useFieldFocus";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { IngredientRow } from "@/hooks/useRecipeForm";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { shouldShowIngredientDelete } from "./ingredients-step-utils";

interface IngredientsStepProps {
  ingredients: IngredientRow[];
  addIngredient: () => void;
  removeIngredient: (key: string) => void;
  updateIngredient: (key: string, text: string) => void;
}

// ── Row component (memoized) ─────────────────────────────────────────────────
// Extracted + React.memo so changing one row's text doesn't re-render every
// other row. `ingredients.length` is hoisted to `showDelete` at the parent
// and passed in; rows themselves never depend on sibling rows.

interface IngredientRowViewProps {
  item: IngredientRow;
  showDelete: boolean;
  onUpdate: (key: string, text: string) => void;
  onRemove: (key: string) => void;
  onSubmit: () => void;
}

const IngredientRowView = React.memo(function IngredientRowView({
  item,
  showDelete,
  onUpdate,
  onRemove,
  onSubmit,
}: IngredientRowViewProps) {
  const { theme } = useTheme();
  const rowFocus = useFieldFocus();

  return (
    // The outer view only carries the add/remove animation; the field is the
    // FocusField inside it, so the ring follows the whole rounded row.
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.rowOuter}
    >
      <FocusField
        focus={rowFocus}
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
        <FocusTextInput
          focusRing={false}
          onFocus={rowFocus.onFocus}
          onBlur={rowFocus.onBlur}
          style={[styles.rowInput, { color: theme.text }]}
          value={item.text}
          onChangeText={(text) => onUpdate(item.key, text)}
          placeholder="e.g. 2 cups flour"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          accessibilityLabel="Ingredient"
          accessibilityHint="Enter an ingredient. Press return to add another."
        />

        {/* Delete button — hidden when only 1 row */}
        {showDelete && (
          <Pressable
            onPress={() => onRemove(item.key)}
            style={styles.deleteButton}
            accessibilityRole="button"
            accessibilityLabel="Remove ingredient"
            hitSlop={12}
          >
            <Feather name="x" size={18} color={theme.error} />
          </Pressable>
        )}
      </FocusField>
    </Animated.View>
  );
});

export default function IngredientsStep({
  ingredients,
  addIngredient,
  removeIngredient,
  updateIngredient,
}: IngredientsStepProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const handleAdd = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    addIngredient();
  }, [addIngredient, haptics]);

  const handleRemove = useCallback(
    (key: string) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      removeIngredient(key);
      AccessibilityInfo.announceForAccessibility("Ingredient removed");
    },
    [removeIngredient, haptics],
  );

  // Voice input APPENDS to the LAST ingredient row as it stood when the mic
  // was tapped. One recognizer lives here at the step level, not per row:
  // every useSpeechToText instance reacts to the same native "start" event,
  // so per-row hooks would all show "listening" at once.
  const voiceTargetRef = useRef<{ key: string; base: string } | null>(null);
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();
  useEffect(() => {
    const target = voiceTargetRef.current;
    if (target && transcript && (isListening || isFinal)) {
      updateIngredient(
        target.key,
        target.base ? `${target.base} ${transcript}` : transcript,
      );
    }
  }, [isListening, isFinal, transcript, updateIngredient]);
  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
      return;
    }
    const last = ingredients[ingredients.length - 1];
    if (!last) return;
    voiceTargetRef.current = { key: last.key, base: last.text.trim() };
    void startListening();
  }, [haptics, isListening, ingredients, startListening, stopListening]);

  // `showDelete` is the only row-level prop that depends on siblings; derive
  // it once here and pass as a primitive prop so rows stay pure.
  const showDelete = useMemo(
    () => shouldShowIngredientDelete(ingredients.length),
    [ingredients.length],
  );

  const renderItem = useCallback(
    ({ item }: { item: IngredientRow }) => (
      <IngredientRowView
        item={item}
        showDelete={showDelete}
        onUpdate={updateIngredient}
        onRemove={handleRemove}
        onSubmit={handleAdd}
      />
    ),
    [showDelete, updateIngredient, handleRemove, handleAdd],
  );

  const ListFooterComponent = (
    <>
      <View style={styles.footerRow}>
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
        <InlineMicButton
          isListening={isListening}
          volume={volume}
          onPress={handleVoicePress}
        />
      </View>
      <InlineError message={speechError} />
    </>
  );

  return (
    <FlatList
      {...FLATLIST_DEFAULTS}
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
  rowOuter: { marginBottom: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
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
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  addRow: {
    flex: 1,
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
