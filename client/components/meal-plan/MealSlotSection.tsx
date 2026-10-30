import React, { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { RecipeAllergenLabel } from "@/components/RecipeAllergenLabel";
import { toRecipeAllergenA11ySuffix } from "@/components/recipe-allergen-label-utils";
import { SwipeableRow } from "@/components/SwipeableRow";
import { DraggableList } from "@/components/DraggableList";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  MEAL_LABELS,
  computeItemMacros,
  formatMacroLine,
  type MealType,
} from "@/screens/meal-plan/meal-plan-utils";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

const MEAL_ICONS: Record<MealType, string> = {
  breakfast: "sunrise",
  lunch: "sun",
  dinner: "moon",
  snack: "coffee",
};

// ── Meal Slot Card ───────────────────────────────────────────────────

export const MealSlotItem = React.memo(function MealSlotItem({
  item,
  isConfirmed,
  onPress,
  onRemove,
  onConfirm,
  canConfirm,
}: {
  item: MealPlanItemWithRelations;
  isConfirmed: boolean;
  onPress: (item: MealPlanItemWithRelations) => void;
  onRemove: (id: number) => void;
  onConfirm: (id: number) => void;
  canConfirm: boolean;
}) {
  const { theme } = useTheme();
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

  const accessLabel = macros
    ? `${name}, ${macros.calories} calories, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fat}g fat${isConfirmed ? ", confirmed" : ""}${allergenA11ySuffix}`
    : `${name}${isConfirmed ? ", confirmed" : ""}${allergenA11ySuffix}`;

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
    () => [
      ...(canConfirm && !isConfirmed
        ? [{ name: "confirm", label: `Confirm ${name} as eaten` }]
        : []),
      { name: "remove", label: `Remove ${name}` },
    ],
    [canConfirm, isConfirmed, name],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "confirm") {
        if (!isConfirmed) onConfirm(item.id);
      } else if (event.nativeEvent.actionName === "remove") {
        onRemove(item.id);
      }
    },
    [isConfirmed, onConfirm, onRemove, item.id],
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
        <ThemedText
          style={[
            styles.mealSlotName,
            isOrphaned && { color: theme.textSecondary, fontStyle: "italic" },
          ]}
          numberOfLines={1}
        >
          {name}
        </ThemedText>
        <RecipeAllergenLabel allergens={item.recipe?.allergens} />
        {macroLine !== null && (
          <ThemedText
            style={[styles.mealSlotCalories, { color: theme.textSecondary }]}
          >
            {macroLine}
          </ThemedText>
        )}
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

// ── Meal Slot Section ────────────────────────────────────────────────

export const MealSlotSection = React.memo(function MealSlotSection({
  mealType,
  items,
  confirmedIds,
  onItemPress,
  onRemoveItem,
  onAddItem,
  onSuggest,
  onConfirmItem,
  onReorder,
  canSuggest,
  canConfirm,
  isExpanded,
  onToggle,
  sectionSummary,
}: {
  mealType: MealType;
  items: MealPlanItemWithRelations[];
  confirmedIds: Set<number>;
  onItemPress: (item: MealPlanItemWithRelations) => void;
  onRemoveItem: (id: number) => void;
  onAddItem: (mealType: MealType) => void;
  onSuggest: (mealType: MealType) => void;
  onConfirmItem: (id: number) => void;
  onReorder?: (items: MealPlanItemWithRelations[]) => void;
  canSuggest: boolean;
  canConfirm: boolean;
  isExpanded: boolean;
  onToggle: (mealType: MealType) => void;
  sectionSummary: { itemCount: number; totalCalories: number };
}) {
  const { theme } = useTheme();
  const iconName = MEAL_ICONS[mealType] || "circle";
  const label = MEAL_LABELS[mealType] || mealType;

  const summaryText =
    sectionSummary.itemCount > 0
      ? ` \u00B7 ${sectionSummary.itemCount} item${sectionSummary.itemCount !== 1 ? "s" : ""} \u00B7 ${sectionSummary.totalCalories} cal`
      : "";

  const headerAccessLabel = isExpanded
    ? `${label}, expanded`
    : `${label}${summaryText}, collapsed`;

  // The header Pressable is accessible by default, which collapses its whole
  // subtree into a single iOS VoiceOver focus stop (device-verified: an RN
  // accessible={true} wrapper collapses its subtree on iOS but NOT on
  // Android — see docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md
  // item 9) — the nested "Suggest" chip below is never independently
  // reachable on iOS VoiceOver when the section is expanded (Android keeps
  // it independently reachable regardless). Expose it as an
  // accessibilityAction on the header instead (additive/harmless on
  // Android; same pattern as CarouselRecipeCard's toggleFavourite/dismiss
  // actions), gated to
  // isExpanded since that's also what gates the chip's own render — a
  // collapsed section has no Suggest chip to route the action to.
  const headerAccessibilityActions = useMemo(
    () =>
      isExpanded
        ? [
            {
              name: "suggest",
              label: canSuggest
                ? `AI suggest ${label.toLowerCase()}`
                : `Upgrade to suggest ${label.toLowerCase()}`,
            },
          ]
        : undefined,
    [isExpanded, canSuggest, label],
  );

  const handleHeaderAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "suggest") {
        onSuggest(mealType);
      }
    },
    [onSuggest, mealType],
  );

  return (
    <View style={styles.mealSlotSection}>
      <Pressable
        onPress={() => onToggle(mealType)}
        style={({ pressed }) => [
          styles.mealSlotHeader,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={headerAccessLabel}
        accessibilityActions={headerAccessibilityActions}
        onAccessibilityAction={handleHeaderAccessibilityAction}
      >
        <Feather
          name={iconName as keyof typeof Feather.glyphMap}
          size={16}
          color={theme.link}
        />
        <ThemedText style={[styles.mealSlotLabel, { flex: 1 }]}>
          {label}
          {!isExpanded && summaryText ? (
            <ThemedText
              style={[styles.collapsedSummary, { color: theme.textSecondary }]}
            >
              {summaryText}
            </ThemedText>
          ) : null}
        </ThemedText>
        {isExpanded && (
          <PressableScale
            scaleTo={0.95}
            onPress={() => onSuggest(mealType)}
            hitSlop={8}
            style={[
              styles.suggestChip,
              {
                backgroundColor: canSuggest
                  ? withOpacity(theme.link, 0.1)
                  : withOpacity(theme.text, 0.05),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              canSuggest
                ? `AI suggest ${label.toLowerCase()}`
                : `Upgrade to suggest ${label.toLowerCase()}`
            }
          >
            <Feather
              name={canSuggest ? "zap" : "lock"}
              size={12}
              color={canSuggest ? theme.link : theme.textSecondary}
            />
            <ThemedText
              style={[
                styles.suggestChipText,
                {
                  color: canSuggest ? theme.link : theme.textSecondary,
                },
              ]}
            >
              Suggest
            </ThemedText>
          </PressableScale>
        )}
        <Feather
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.textSecondary}
          style={{ marginLeft: Spacing.sm }}
        />
      </Pressable>
      {isExpanded && (
        <View>
          {items.length > 1 && onReorder ? (
            <DraggableList
              items={items}
              keyExtractor={(item) => item.id}
              renderItem={(item) => (
                <SwipeableRow
                  rightAction={{
                    icon: "trash-2",
                    label: "Remove",
                    backgroundColor: theme.error,
                    onAction: () => onRemoveItem(item.id),
                  }}
                >
                  <MealSlotItem
                    item={item}
                    isConfirmed={confirmedIds.has(item.id)}
                    onPress={onItemPress}
                    onRemove={onRemoveItem}
                    onConfirm={onConfirmItem}
                    canConfirm={canConfirm}
                  />
                </SwipeableRow>
              )}
              onReorder={onReorder}
            />
          ) : (
            items.map((item) => (
              <SwipeableRow
                key={item.id}
                rightAction={{
                  icon: "trash-2",
                  label: "Remove",
                  backgroundColor: theme.error,
                  onAction: () => onRemoveItem(item.id),
                }}
              >
                <MealSlotItem
                  item={item}
                  isConfirmed={confirmedIds.has(item.id)}
                  onPress={onItemPress}
                  onRemove={onRemoveItem}
                  onConfirm={onConfirmItem}
                  canConfirm={canConfirm}
                />
              </SwipeableRow>
            ))
          )}
          <Pressable
            onPress={() => onAddItem(mealType)}
            style={({ pressed }) => [
              styles.addItemButton,
              { borderColor: withOpacity(theme.text, 0.1) },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${label.toLowerCase()} item`}
          >
            <Feather name="plus" size={16} color={theme.link} />
            <ThemedText style={[styles.addItemText, { color: theme.link }]}>
              {`Add ${label.toLowerCase()} item`}
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  mealSlotSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  mealSlotHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  mealSlotLabel: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  collapsedSummary: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
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
  mealSlotCalories: {
    fontSize: 13,
    marginTop: 2,
  },
  addItemButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.xs,
  },
  addItemText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  suggestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  suggestChipText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
