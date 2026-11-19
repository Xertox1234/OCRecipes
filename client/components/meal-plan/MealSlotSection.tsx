import React, { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { SwipeableRow } from "@/components/SwipeableRow";
import { DraggableList } from "@/components/DraggableList";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { type ItemFamilyInfo } from "@/components/meal-plan/family-utils";
import { MealSlotItem } from "@/components/meal-plan/MealSlotItem";
import {
  MEAL_LABELS,
  type MealType,
} from "@/components/meal-plan/meal-plan-utils";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

const MEAL_ICONS: Record<MealType, string> = {
  breakfast: "sunrise",
  lunch: "sun",
  dinner: "moon",
  snack: "coffee",
};

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
  familyById,
  onChangeAudience,
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
  /** Family info per item id; absent when family planning is off. */
  familyById?: Record<number, ItemFamilyInfo>;
  onChangeAudience?: (item: MealPlanItemWithRelations) => void;
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
                    family={familyById?.[item.id]}
                    onChangeAudience={onChangeAudience}
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
                  family={familyById?.[item.id]}
                  onChangeAudience={onChangeAudience}
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
    minWidth: 44,
    minHeight: 44,
  },
  suggestChipText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
