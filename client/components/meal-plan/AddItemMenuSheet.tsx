import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { ImpactFeedbackStyle } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import {
  SheetDragHandle,
  SheetOptionRow,
} from "@/components/sheet/SheetChrome";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { FeatureTip } from "@/components/FeatureTip";
import {
  AudienceChoice,
  type AudienceChoiceValue,
} from "@/components/meal-plan/AudienceChoice";
import type { FamilyProfile } from "@shared/schema";
import { useFeatureTip } from "@/hooks/useFeatureTip";
import { Spacing, FontFamily } from "@/constants/theme";
import {
  MEAL_LABELS,
  type MealType,
} from "@/components/meal-plan/meal-plan-utils";

export const ADD_ITEM_MENU_SNAP_POINTS = ["45%"];
/** Taller: for a screen whose menu also carries the "Suggest a meal" row. */
export const ADD_ITEM_MENU_WITH_SUGGEST_SNAP_POINTS = ["58%"];

interface AddItemMenuSheetContentProps {
  mealType: MealType | null;
  onChooseRecipe: () => void;
  onSimpleEntry: () => void;
  onImportRecipe: () => void;
  /** Offers a "Suggest a meal" row. Omit it and the row is not shown. */
  onSuggest?: () => void;
  /** The day being added to ("Tue, Nov 17"), for a screen that shows several. */
  dayLabel?: string;
  /**
   * "Who's it for?" for a plan with family profiles. Omit it and the row is
   * not shown (family planning off, or no profiles).
   */
  audience?: {
    profiles: FamilyProfile[];
    value: AudienceChoiceValue;
    onChange: (choice: AudienceChoiceValue) => void;
  };
}

function AddItemMenuSheetContentInner({
  mealType,
  onChooseRecipe,
  onSimpleEntry,
  onImportRecipe,
  onSuggest,
  dayLabel,
  audience,
}: AddItemMenuSheetContentProps) {
  const haptics = useHaptics();
  // Guards against a near-simultaneous double-tap on two different rows: each
  // handler synchronously clears the parent's menu state and defers opening
  // the next sheet via runAfterTransition, so two fast taps before the first
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

  const handleSuggest = useCallback(() => {
    if (isActioning.current) return;
    isActioning.current = true;
    haptics.impact(ImpactFeedbackStyle.Light);
    onSuggest?.();
  }, [haptics, onSuggest]);

  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";

  // Pro only: import by link or photo is a premium feature.
  const canImport = usePremiumFeature("urlImport");
  const importTip = useFeatureTip("plan-import", {
    feature: "import",
    eligible: canImport,
  });

  return (
    // accessibilityViewIsModal must live on the content's outermost element
    // (the scroll view below) — BottomSheetModal
    // typechecks the prop but never forwards it (verified in @gorhom/bottom-sheet
    // source), so setting it on the modal is a silent no-op. iOS-only prop;
    // traps VoiceOver focus so the screen behind the sheet is unreachable while
    // it's presented. See docs/solutions/conventions/
    // a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md.
    // The scroll view is for large text: the sheet's height is fixed, and with
    // the "Who's it for?" row the last option otherwise falls below it.
    <BottomSheetScrollView
      testID="add-item-menu-scroll"
      bounces={false}
      accessibilityViewIsModal
    >
      <View style={styles.content}>
        <SheetDragHandle />
        <ThemedText style={styles.title}>
          {dayLabel ? `Add to ${label} · ${dayLabel}` : `Add to ${label}`}
        </ThemedText>
        {audience ? (
          <View style={styles.audience}>
            <ThemedText style={styles.audienceLabel}>
              {"Who's it for?"}
            </ThemedText>
            <AudienceChoice
              profiles={audience.profiles}
              value={audience.value}
              onChange={audience.onChange}
            />
          </View>
        ) : null}
        <View style={styles.options}>
          <SheetOptionRow
            icon="book-open"
            title="Choose Recipe"
            description="Search your recipes or create new"
            onPress={handleChooseRecipe}
            accessibilityLabel="Choose recipe"
          />
          <SheetOptionRow
            icon="edit-3"
            title="Simple Entry"
            description="Type a dish name, AI estimates nutrition"
            onPress={handleSimpleEntry}
            accessibilityLabel="Simple entry"
          />
          <SheetOptionRow
            icon="download"
            title="Import Recipe"
            description="From URL, photo, or clipboard"
            onPress={handleImportRecipe}
            accessibilityLabel="Import recipe"
          />
          {onSuggest ? (
            <SheetOptionRow
              icon="zap"
              title="Suggest a meal"
              description="Ideas that fit your goals for this meal"
              onPress={handleSuggest}
              accessibilityLabel="Suggest a meal"
            />
          ) : null}
          <FeatureTip
            text="Paste a link or snap a cookbook page."
            visible={importTip.visible}
            onDismiss={importTip.dismiss}
            pointer="up"
            pointerAlign="start"
          />
        </View>
      </View>
    </BottomSheetScrollView>
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
  title: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
    alignSelf: "flex-start",
    marginBottom: Spacing.md,
  },
  audience: {
    width: "100%",
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  audienceLabel: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  options: {
    width: "100%",
    gap: Spacing.sm,
  },
});
