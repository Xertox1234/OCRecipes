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
// so a larger system font can never grow a cell out of the grid.
export const CELL_HEIGHT = 96;
export const CELL_IMAGE_HEIGHT = 36;
export const DAY_HEADER_HEIGHT = 52;
const TITLE_FONT_SIZE = 12;
const BOTTOM_LINE_FONT_SIZE = 11;

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
      <View style={styles.body}>
        <ThemedText
          style={[styles.title, { color: theme.text }]}
          numberOfLines={imageUri ? 2 : 3}
        >
          {cell.title}
        </ThemedText>
        <ThemedText
          style={[styles.bottomLine, { color: theme.textSecondary }]}
          numberOfLines={1}
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
  image: {
    width: "100%",
    height: CELL_IMAGE_HEIGHT,
  },
  body: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 6,
    paddingTop: 5,
    paddingBottom: 6,
  },
  title: {
    fontSize: TITLE_FONT_SIZE,
    lineHeight: 15,
    fontFamily: FontFamily.semiBold,
  },
  bottomLine: {
    fontSize: BOTTOM_LINE_FONT_SIZE,
    lineHeight: 14,
    fontFamily: FontFamily.medium,
  },
});
