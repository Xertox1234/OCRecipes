import React, { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { RecipeAllergenLabel } from "@/components/RecipeAllergenLabel";
import { toRecipeAllergenA11ySuffix } from "@/components/recipe-allergen-label-utils";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  type ItemFamilyInfo,
  countsTowardUser,
} from "@/components/meal-plan/family-utils";
import {
  computeItemMacros,
  formatMacroLine,
} from "@/components/meal-plan/meal-plan-utils";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

/**
 * The row's screen-reader actions. Confirm is left out once confirmed, and for
 * a profile's meal, which can never be confirmed as eaten. "Who's it for?"
 * only when family planning is on.
 */
export function getItemAccessibilityActions(
  item: Pick<MealPlanItemWithRelations, "audience">,
  canConfirm: boolean,
  isConfirmed: boolean,
  name: string,
  canChangeAudience = false,
): { name: string; label: string }[] {
  return [
    ...(canConfirm && countsTowardUser(item) && !isConfirmed
      ? [{ name: "confirm", label: `Confirm ${name} as eaten` }]
      : []),
    ...(canChangeAudience
      ? [{ name: "audience", label: "Who's it for?" }]
      : []),
    { name: "remove", label: `Remove ${name}` },
  ];
}

export const MealSlotItem = React.memo(function MealSlotItem({
  item,
  isConfirmed,
  onPress,
  onRemove,
  onConfirm,
  canConfirm: canConfirmProp,
  family,
  onChangeAudience,
}: {
  item: MealPlanItemWithRelations;
  isConfirmed: boolean;
  onPress: (item: MealPlanItemWithRelations) => void;
  onRemove: (id: number) => void;
  onConfirm: (id: number) => void;
  canConfirm: boolean;
  /** Who the meal is for and its clashes; absent when family planning is off. */
  family?: ItemFamilyInfo;
  /** Opens "Who's it for?" for this row. */
  onChangeAudience?: (item: MealPlanItemWithRelations) => void;
}) {
  const { theme } = useTheme();
  // A profile's own meal can never be confirmed as eaten.
  const canConfirm = canConfirmProp && countsTowardUser(item);
  const isOrphaned =
    !item.recipe && !item.scannedItem && !item.recipeId && !item.scannedItemId;
  const name = isOrphaned
    ? "Item removed"
    : item.recipe?.title || item.scannedItem?.productName || "Unknown item";
  const macros = isOrphaned ? null : computeItemMacros(item);
  const macroLine = macros ? formatMacroLine(macros) : null;

  // Scanned items carry no derived-allergen cache (that's product-level data,
  // a separate concept) — only a recipe-backed item can have one. The card
  // Pressable is accessible by default, which collapses its whole subtree
  // into a single iOS VoiceOver focus stop (device-verified: an RN
  // accessible={true} wrapper collapses its subtree on iOS but NOT on
  // Android — see docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md
  // item 9), so fold the allergen text into the card's own label (same
  // pattern as RecipeBrowserScreen's UnifiedRecipeCard) rather than relying
  // on the nested label's own container.
  const allergenA11ySuffix = toRecipeAllergenA11ySuffix(item.recipe?.allergens);

  const canChangeAudience = family !== undefined && !!onChangeAudience;
  // The row is one screen-reader stop, so the audience and the clashes ride in
  // its own label.
  const familyA11ySuffix = family
    ? `${family.audienceLabel ? `, ${family.audienceLabel}` : ""}${family.clashLines.map((line) => `. ${line}`).join("")}`
    : "";

  const accessLabel = macros
    ? `${name}, ${macros.calories} calories, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fat}g fat${isConfirmed ? ", confirmed" : ""}${familyA11ySuffix}${allergenA11ySuffix}`
    : `${name}${isConfirmed ? ", confirmed" : ""}${familyA11ySuffix}${allergenA11ySuffix}`;

  // The card Pressable above is accessible by default, which collapses its
  // whole subtree into a single iOS VoiceOver focus stop (same device-verified
  // iOS-only collapse cited above) — the nested Confirm and Remove Pressables
  // below are never independently reachable on iOS VoiceOver (Android keeps
  // them independently reachable regardless — see the same citation).
  // Expose both as accessibilityActions on the card instead (additive/
  // harmless on Android; same pattern as CarouselRecipeCard's
  // toggleFavourite/dismiss actions) so the primary
  // label stays the single focus stop while Confirm/Remove are still
  // independently activatable via the screen reader's actions/rotor. Confirm
  // is omitted once there's nothing left to confirm (mirrors `canConfirm`
  // gating the nested button's render + the `!isConfirmed &&` guard on its
  // onPress); Remove has no such gate, matching its unconditional render.
  const accessibilityActions = useMemo(
    () =>
      getItemAccessibilityActions(
        item,
        canConfirm,
        isConfirmed,
        name,
        canChangeAudience,
      ),
    [item, canConfirm, isConfirmed, name, canChangeAudience],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "confirm") {
        if (canConfirm && !isConfirmed) onConfirm(item.id);
      } else if (event.nativeEvent.actionName === "audience") {
        onChangeAudience?.(item);
      } else if (event.nativeEvent.actionName === "remove") {
        onRemove(item.id);
      }
    },
    [canConfirm, isConfirmed, onConfirm, onRemove, onChangeAudience, item],
  );

  return (
    <Pressable
      onPress={() => !isOrphaned && onPress(item)}
      style={({ pressed }) => [
        styles.mealSlotItem,
        {
          backgroundColor: isOrphaned
            ? withOpacity(theme.text, 0.02)
            : isConfirmed
              ? withOpacity(theme.success, 0.08)
              : withOpacity(theme.text, 0.04),
        },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessLabel}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
    >
      {canConfirm && (
        <Pressable
          onPress={() => !isConfirmed && onConfirm(item.id)}
          style={({ pressed }) => [
            {
              width: 44,
              height: 44,
              justifyContent: "center",
              alignItems: "center",
              marginRight: Spacing.sm,
            },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            isConfirmed ? `${name} confirmed` : `Confirm ${name} as eaten`
          }
          disabled={isConfirmed}
        >
          <Feather
            name={isConfirmed ? "check-circle" : "circle"}
            size={20}
            color={isConfirmed ? theme.success : theme.textSecondary}
          />
        </Pressable>
      )}
      <View style={styles.mealSlotContent}>
        <View style={styles.mealSlotTitleRow}>
          <ThemedText
            style={[
              styles.mealSlotName,
              styles.mealSlotNameShrink,
              isOrphaned && { color: theme.textSecondary, fontStyle: "italic" },
            ]}
            numberOfLines={1}
          >
            {name}
          </ThemedText>
          {family?.audienceLabel ? (
            <ThemedText
              style={[styles.audienceLabel, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {family.audienceLabel}
            </ThemedText>
          ) : null}
        </View>
        <RecipeAllergenLabel allergens={item.recipe?.allergens} />
        {family?.clashLines.map((line) => (
          <ThemedText
            key={line}
            style={[
              styles.clashLine,
              {
                color:
                  line.startsWith("Contains") || line.startsWith("May contain")
                    ? theme.error
                    : theme.textSecondary,
              },
            ]}
          >
            {line}
          </ThemedText>
        ))}
        {macroLine !== null && (
          <ThemedText
            style={[styles.mealSlotCalories, { color: theme.textSecondary }]}
          >
            {macroLine}
          </ThemedText>
        )}
        {canChangeAudience ? (
          <Pressable
            onPress={() => onChangeAudience?.(item)}
            style={({ pressed }) => [
              styles.audienceButton,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            // Its own focus stop on Android, so it names its meal.
            accessibilityLabel={`Who's it for? ${name}`}
          >
            <Feather name="users" size={14} color={theme.link} />
            <ThemedText
              style={[styles.audienceButtonText, { color: theme.link }]}
            >
              {"Who's it for?"}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={() => onRemove(item.id)}
        style={({ pressed }) => [
          {
            width: 44,
            height: 44,
            justifyContent: "center",
            alignItems: "center",
          },
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
      >
        <Feather name="x" size={16} color={theme.textSecondary} />
      </Pressable>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  mealSlotItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.xs,
  },
  mealSlotContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  mealSlotName: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  mealSlotTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
  },
  mealSlotNameShrink: {
    flexShrink: 1,
  },
  audienceLabel: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  clashLine: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
    marginTop: 2,
  },
  audienceButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    minHeight: 44,
    alignSelf: "flex-start",
  },
  audienceButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  mealSlotCalories: {
    fontSize: 13,
    marginTop: 2,
  },
});
