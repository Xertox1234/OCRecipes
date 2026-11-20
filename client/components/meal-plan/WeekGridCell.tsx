import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { FallbackImage } from "@/components/FallbackImage";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import {
  BorderRadius,
  CameraColors,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { resolveImageUrl } from "@/lib/query-client";

import type { MealType } from "./meal-plan-utils";
import { type GridDay, getCellAccessibilityLabel } from "./week-grid-utils";

// ── Sizes ────────────────────────────────────────────────────────────
// A day column is only about 100pt wide, so a cell holds exactly this much:
// a title and, when more items share the slot, a "+1" line. With a picture,
// the picture fills the cell and the text sits on a dark overlay along the
// bottom; without one, the text sits on the plain cell. Heights are fixed so
// the grid stays a grid; text scaling is capped to what still fits (the day
// screen shows every meal at full Dynamic Type size).
export const CELL_HEIGHT = 100;
export const DAY_HEADER_HEIGHT = 52;
/** Cap on Dynamic Type inside the grid. See `getCellContentHeight`. */
export const GRID_MAX_FONT_SCALE = 1.2;
const TITLE_FONT_SIZE = 11;
const TITLE_LINE_HEIGHT = 14;
const EXTRA_LINE_FONT_SIZE = 10;
const EXTRA_LINE_HEIGHT = 13;
const BODY_PADDING_TOP = 5;
const BODY_PADDING_BOTTOM = 6;
const TITLE_LINES_WITH_IMAGE = 2;
const TITLE_LINES_WITHOUT_IMAGE = 3;

/**
 * Height a filled cell's text block needs at a given text scale, "+1" line
 * included. Over a picture this is the overlay's height.
 */
export function getCellContentHeight(
  fontScale: number,
  hasImage: boolean,
): number {
  const titleLines = hasImage
    ? TITLE_LINES_WITH_IMAGE
    : TITLE_LINES_WITHOUT_IMAGE;
  return (
    BODY_PADDING_TOP +
    (titleLines * TITLE_LINE_HEIGHT + EXTRA_LINE_HEIGHT) * fontScale +
    BODY_PADDING_BOTTOM
  );
}

/** Size of the audience badge; it sits in the cell's top right corner. */
const BADGE_SIZE = 16;
const CORNER_INSET = 4;

/**
 * The overlay under the title. A picture can be any colour, so the overlay is
 * the same dark in both themes and the text on it is white (`buttonText`).
 * 0.6 black keeps white text at 4.5:1 even over a pure white picture.
 */
const TITLE_OVERLAY_COLOR = CameraColors.overlayMediumDark;

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
  const textColor = imageUri ? theme.buttonText : theme.text;
  const extraColor = imageUri ? theme.buttonText : theme.textSecondary;

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
      <View
        testID={imageUri ? "cell-title-overlay" : undefined}
        style={[
          styles.body,
          imageUri
            ? [styles.overlay, { backgroundColor: TITLE_OVERLAY_COLOR }]
            : styles.bodyFill,
        ]}
      >
        <ThemedText
          style={[
            styles.title,
            { color: textColor },
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
        {cell.extraCount > 0 ? (
          <ThemedText
            style={[styles.extraLine, { color: extraColor }]}
            numberOfLines={1}
            maxScale={GRID_MAX_FONT_SCALE}
          >
            {`+${cell.extraCount}`}
          </ThemedText>
        ) : null}
      </View>
      {/* The badge is drawn over the cell (absolute), so it never changes the
          cell's height or where its text sits. The cell's own label already
          says "for Ivy", so it is decorative. */}
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
  image: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  body: {
    paddingHorizontal: 6,
    paddingTop: BODY_PADDING_TOP,
    paddingBottom: BODY_PADDING_BOTTOM,
  },
  bodyFill: {
    flex: 1,
    justifyContent: "space-between",
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  titleBesideBadge: {
    paddingRight: BADGE_SIZE + CORNER_INSET,
  },
  title: {
    fontSize: TITLE_FONT_SIZE,
    lineHeight: TITLE_LINE_HEIGHT,
    fontFamily: FontFamily.regular,
  },
  extraLine: {
    fontSize: EXTRA_LINE_FONT_SIZE,
    lineHeight: EXTRA_LINE_HEIGHT,
    fontFamily: FontFamily.regular,
  },
});
