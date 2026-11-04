import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { ImpactFeedbackStyle } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import {
  SheetDragHandle,
  SheetOptionRow,
} from "@/components/sheet/SheetChrome";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { FeatureTip } from "@/components/FeatureTip";
import { useFeatureTip } from "@/hooks/useFeatureTip";
import { Spacing, FontFamily } from "@/constants/theme";
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

  const label = mealType ? MEAL_LABELS[mealType] || mealType : "";

  // Pro only: import by link or photo is a premium feature.
  const canImport = usePremiumFeature("urlImport");
  const importTip = useFeatureTip("plan-import", {
    feature: "import",
    eligible: canImport,
  });

  return (
    // accessibilityViewIsModal must live on this inner View — BottomSheetModal
    // typechecks the prop but never forwards it (verified in @gorhom/bottom-sheet
    // source), so setting it on the modal is a silent no-op. iOS-only prop;
    // traps VoiceOver focus so the screen behind the sheet is unreachable while
    // it's presented. See docs/solutions/conventions/
    // a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md.
    <View style={styles.content} accessibilityViewIsModal>
      <SheetDragHandle />
      <ThemedText style={styles.title}>Add to {label}</ThemedText>
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
        <FeatureTip
          text="Paste a link or snap a cookbook page."
          visible={importTip.visible}
          onDismiss={importTip.dismiss}
          pointer="up"
          pointerAlign="start"
        />
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
});
