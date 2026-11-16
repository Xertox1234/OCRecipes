import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { FallbackImage } from "@/components/FallbackImage";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, FontFamily, withOpacity } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { resolveImageUrl } from "@/lib/query-client";

import type { MealType } from "./meal-plan-utils";
import { type GridDay, getCellAccessibilityLabel } from "./week-grid-utils";

// ── Sizes ────────────────────────────────────────────────────────────
// A day column is only about 100pt wide, so a cell holds exactly this much:
// an optional image strip, a title, and one bottom line. Heights are fixed
// so the grid stays a grid; text scaling is capped to what still fits (the
// day screen shows every meal at full Dynamic Type size).
export const CELL_HEIGHT = 100;
export const CELL_IMAGE_HEIGHT = 36;
export const DAY_HEADER_HEIGHT = 52;
/** Cap on Dynamic Type inside the grid. See `getCellContentHeight`. */
export const GRID_MAX_FONT_SCALE = 1.2;
const TITLE_FONT_SIZE = 12;
const TITLE_LINE_HEIGHT = 15;
const BOTTOM_LINE_FONT_SIZE = 11;
const BOTTOM_LINE_HEIGHT = 14;
const BODY_PADDING_TOP = 5;
const BODY_PADDING_BOTTOM = 6;
const TITLE_LINES_WITH_IMAGE = 2;
const TITLE_LINES_WITHOUT_IMAGE = 3;

/** Height a filled cell's contents need at a given text scale. */
export function getCellContentHeight(
  fontScale: number,
  hasImage: boolean,
): number {
  const titleLines = hasImage
    ? TITLE_LINES_WITH_IMAGE
    : TITLE_LINES_WITHOUT_IMAGE;
  return (
    (hasImage ? CELL_IMAGE_HEIGHT : 0) +
    BODY_PADDING_TOP +
    (titleLines * TITLE_LINE_HEIGHT + BOTTOM_LINE_HEIGHT) * fontScale +
    BODY_PADDING_BOTTOM
  );
}

/** Size of the audience badge and the warning mark; both sit in a corner. */
const BADGE_SIZE = 16;
const WARNING_SIZE = 12;
const CORNER_INSET = 4;

/** "610", or "1,150 · +1" when more items share the slot. */
function formatBottomLine(calories: number, extraCount: number): string {
  const kcal = calories.toLocaleString("en-US");
  return extraCount > 0 ? `${kcal} · +${extraCount}` : kcal;
}

export const WeekGridCell = React.memo(function WeekGridCell({
  day,
  mealType,
  onAddPress,
  onDayPress,
}: {
  day: GridDay;
  mealType: MealType;
  onAddPress: (dateStr: string, mealType: MealType) => void;
  onDayPress: (dateStr: string) => void;
}) {
  const { theme } = useTheme();
  const cell = day.cells[mealType];
  const accessibilityLabel = getCellAccessibilityLabel(day, mealType);

  if (cell.title === null) {
    return (
      <PressableScale
        scaleTo={0.97}
        onPress={() => onAddPress(day.dateStr, mealType)}
        style={[
          styles.cell,
          styles.emptyCell,
          { borderColor: withOpacity(theme.text, 0.18) },
        ]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Feather
          name="plus"
          size={18}
          color={theme.textSecondary}
          accessible={false}
        />
      </PressableScale>
    );
  }

  const imageUri = resolveImageUrl(cell.imageUrl);

  return (
    <PressableScale
      scaleTo={0.97}
      onPress={() => onDayPress(day.dateStr)}
      style={[styles.cell, { backgroundColor: theme.backgroundSecondary }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {imageUri ? (
        <FallbackImage
          source={{ uri: imageUri }}
          style={styles.image}
          fallbackStyle={{ backgroundColor: withOpacity(theme.text, 0.08) }}
          fallbackIcon="image"
          fallbackIconSize={14}
          accessible={false}
        />
      ) : null}
      {/* Both marks are drawn over the cell (absolute), so they never change
          its height or where its text sits. The cell's own label already
          says "for Ivy" and "allergen warning", so they are decorative. */}
      {cell.family?.badge ? (
        <View
          testID="cell-audience-badge"
          style={[styles.badge, { backgroundColor: theme.accentSolid }]}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {cell.family.badge.kind === "shared" ? (
            <Feather name="users" size={10} color={theme.buttonText} />
          ) : (
            <ThemedText
              maxScale={GRID_MAX_FONT_SCALE}
              style={[styles.badgeInitial, { color: theme.buttonText }]}
            >
              {cell.family.badge.initial}
            </ThemedText>
          )}
        </View>
      ) : null}
      {cell.family?.warning ? (
        <View
          testID="cell-allergen-warning"
          style={styles.warning}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Feather
            name="alert-triangle"
            size={WARNING_SIZE}
            color={theme.error}
          />
        </View>
      ) : null}
      <View style={styles.body}>
        <ThemedText
          style={[
            styles.title,
            { color: theme.text },
            // With no image the badge sits over the title's corner.
            cell.family?.badge && !imageUri ? styles.titleBesideBadge : null,
          ]}
          numberOfLines={
            imageUri ? TITLE_LINES_WITH_IMAGE : TITLE_LINES_WITHOUT_IMAGE
          }
          maxScale={GRID_MAX_FONT_SCALE}
        >
          {cell.title}
        </ThemedText>
        <ThemedText
          style={[styles.bottomLine, { color: theme.textSecondary }]}
          numberOfLines={1}
          maxScale={GRID_MAX_FONT_SCALE}
        >
          {formatBottomLine(cell.calories, cell.extraCount)}
        </ThemedText>
      </View>
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  cell: {
    height: CELL_HEIGHT,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  emptyCell: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
  },
  badge: {
    position: "absolute",
    top: CORNER_INSET,
    right: CORNER_INSET,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeInitial: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: FontFamily.bold,
  },
  warning: {
    position: "absolute",
    bottom: CORNER_INSET,
    right: CORNER_INSET,
    width: WARNING_SIZE,
    height: WARNING_SIZE,
  },
  image: {
    width: "100%",
    height: CELL_IMAGE_HEIGHT,
  },
  body: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 6,
    paddingTop: BODY_PADDING_TOP,
    paddingBottom: BODY_PADDING_BOTTOM,
  },
  titleBesideBadge: {
    paddingRight: BADGE_SIZE + CORNER_INSET,
  },
  title: {
    fontSize: TITLE_FONT_SIZE,
    lineHeight: TITLE_LINE_HEIGHT,
    fontFamily: FontFamily.semiBold,
  },
  bottomLine: {
    fontSize: BOTTOM_LINE_FONT_SIZE,
    lineHeight: BOTTOM_LINE_HEIGHT,
    fontFamily: FontFamily.medium,
  },
});
