import React, { useCallback } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import type { Feather } from "@expo/vector-icons";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";

import { Button } from "@/components/Button";
import { ThemedText } from "@/components/ThemedText";
import {
  SheetDragHandle,
  SheetOptionRow,
} from "@/components/sheet/SheetChrome";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useSheetBackHandler } from "@/hooks/useSheetBackHandler";
import { useSheetHostProps } from "@/hooks/useSheetHostProps";
import { useDismissCarouselRecipe } from "@/hooks/useCarouselRecipes";
import { Spacing, FontFamily } from "@/constants/theme";
import type { RecipeDismissReason } from "@shared/constants/recipe-dismiss-reasons";
import type { CarouselRecipeCard } from "@shared/types/carousel";

const REASON_OPTIONS: {
  id: RecipeDismissReason;
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  description: string;
}[] = [
  {
    id: "contains_avoided",
    icon: "alert-triangle",
    title: "Has something I avoid",
    description: "An allergen or an ingredient I don't eat",
  },
  {
    id: "diet_mismatch",
    icon: "sliders",
    title: "Doesn't fit my diet",
    description: "Not right for my diet or goals",
  },
  {
    id: "cuisine_disliked",
    icon: "globe",
    title: "Not a cuisine I like",
    description: "I'm not into this style of cooking",
  },
  {
    id: "not_interested",
    icon: "eye-off",
    title: "Just not interested",
    description: "Something else, or no reason",
  },
];

interface DismissReasonSheetContentProps {
  onPick: (reason: RecipeDismissReason) => void;
  onKeep: () => void;
}

export function DismissReasonSheetContent({
  onPick,
  onKeep,
}: DismissReasonSheetContentProps) {
  return (
    // accessibilityViewIsModal lives on this inner View — BottomSheetModal
    // never forwards it. See docs/solutions/conventions/
    // a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md.
    <View style={styles.content} accessibilityViewIsModal>
      <SheetDragHandle />
      <ThemedText style={styles.title} accessibilityRole="header">
        Why hide this recipe?
      </ThemedText>
      <View style={styles.options}>
        {REASON_OPTIONS.map((option) => (
          <SheetOptionRow
            key={option.id}
            icon={option.icon}
            title={option.title}
            description={option.description}
            onPress={() => onPick(option.id)}
            accessibilityLabel={option.title}
          />
        ))}
      </View>
      <Button variant="ghost" onPress={onKeep} style={styles.keepButton}>
        Keep this recipe
      </Button>
    </View>
  );
}

interface DismissReasonSheetProps {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  /** The card the sheet is asking about; set by `useDismissReasonSheet`. */
  cardRef: React.RefObject<CarouselRecipeCard | null>;
}

/**
 * Asks why before a For You recipe is hidden, then hides it with that reason.
 * Closing the sheet any other way (Keep, swipe, backdrop) hides nothing.
 */
export function DismissReasonSheet({
  sheetRef,
  cardRef,
}: DismissReasonSheetProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { mutate: dismissRecipe } = useDismissCarouselRecipe();
  const hostProps = useSheetHostProps({
    backgroundColor: theme.backgroundDefault,
    backdropOpacity: 0.35,
    backdropPressBehavior: "close",
  });
  // Imperative host — see useSheetBackHandler's JSDoc for onSheetChange/onSheetAnimate semantics.
  const { onSheetChange, onSheetAnimate } = useSheetBackHandler(sheetRef);

  const handlePick = useCallback(
    (reason: RecipeDismissReason) => {
      const card = cardRef.current;
      if (!card) return;
      // Cleared first so a second fast tap on another reason does nothing.
      cardRef.current = null;
      dismissRecipe({ recipeId: card.id, reason });
      AccessibilityInfo.announceForAccessibility("Recipe hidden");
      sheetRef.current?.dismiss();
    },
    [cardRef, dismissRecipe, sheetRef],
  );

  const handleKeep = useCallback(() => {
    sheetRef.current?.dismiss();
  }, [sheetRef]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      onChange={onSheetChange}
      onAnimate={onSheetAnimate}
      animationConfigs={reducedMotion ? { duration: 0 } : undefined}
      {...hostProps}
    >
      <BottomSheetView>
        <DismissReasonSheetContent onPick={handlePick} onKeep={handleKeep} />
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
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
  keepButton: {
    marginTop: Spacing.md,
    alignSelf: "stretch",
  },
});
