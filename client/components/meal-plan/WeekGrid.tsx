import React, { useEffect, useRef } from "react";
import {
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";

import { MEAL_LABELS, type MealType } from "./meal-plan-utils";
import { CELL_HEIGHT, DAY_HEADER_HEIGHT, WeekGridCell } from "./WeekGridCell";
import {
  GRID_COLUMN_GAP,
  GRID_LABEL_COLUMN_WIDTH,
  GRID_MEAL_TYPES,
  type GridDay,
  getDayHeaderAccessibilityLabel,
  getGridColumnWidth,
  getInitialColumnIndex,
} from "./week-grid-utils";

const KCAL_ROW_HEIGHT = 28;

const DayHeader = React.memo(function DayHeader({
  day,
  onDayPress,
}: {
  day: GridDay;
  onDayPress: (dateStr: string) => void;
}) {
  const { theme } = useTheme();
  const dayName = day.date
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();

  return (
    <PressableScale
      scaleTo={0.97}
      onPress={() => onDayPress(day.dateStr)}
      style={[
        styles.dayHeader,
        {
          // Same treatment the date strip gives its selected day.
          backgroundColor: day.isToday
            ? theme.accentSolid
            : withOpacity(theme.text, 0.05),
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={getDayHeaderAccessibilityLabel(day)}
    >
      <ThemedText
        style={[
          styles.dayName,
          { color: day.isToday ? theme.buttonText : theme.textSecondary },
        ]}
      >
        {dayName}
      </ThemedText>
      <ThemedText
        style={[
          styles.dayNum,
          { color: day.isToday ? theme.buttonText : theme.text },
        ]}
      >
        {day.date.getDate()}
      </ThemedText>
    </PressableScale>
  );
});

/**
 * The Plan tab's week: meal labels fixed on the left, seven day columns
 * scrolling sideways (three visible plus a peek of the next), and each day's
 * planned calories along the bottom. Opens on today's column.
 */
export function WeekGrid({
  days,
  onAddPress,
  onDayPress,
}: {
  days: GridDay[];
  onAddPress: (dateStr: string, mealType: MealType) => void;
  onDayPress: (dateStr: string) => void;
}) {
  const { theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const columnWidth = getGridColumnWidth(windowWidth);
  const columnStride = columnWidth + GRID_COLUMN_GAP;
  const scrollRef = useRef<ScrollViewInstance>(null);

  // Open on today's column, and again whenever the week itself changes. The
  // offset depends only on which week is shown, where today falls in it and
  // the column width, so a meal added to the same week never yanks the grid
  // back while the user is looking at Friday.
  const firstDateStr = days[0]?.dateStr;
  const initialOffset = getInitialColumnIndex(days) * columnStride;
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: initialOffset, animated: false });
  }, [firstDateStr, initialOffset]);

  return (
    <View style={styles.grid}>
      {/* Row labels. Every cell's own label names its meal, so this column
          is visual only. */}
      <View
        style={styles.labelColumn}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.labelHeaderSpacer} />
        {GRID_MEAL_TYPES.map((mealType) => (
          <View key={mealType} style={styles.rowLabel}>
            <ThemedText
              style={[styles.rowLabelText, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {MEAL_LABELS[mealType]}
            </ThemedText>
          </View>
        ))}
        <View style={styles.kcalLabel}>
          <ThemedText
            style={[styles.rowLabelText, { color: theme.textSecondary }]}
          >
            kcal
          </ThemedText>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        testID="week-grid-scroll"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: initialOffset, y: 0 }}
        snapToInterval={columnStride}
        decelerationRate="fast"
        // Off-screen day columns must stay reachable by screen readers.
        removeClippedSubviews={false}
        contentContainerStyle={styles.columns}
      >
        {days.map((day) => (
          <View key={day.dateStr} style={{ width: columnWidth }}>
            <DayHeader day={day} onDayPress={onDayPress} />
            {GRID_MEAL_TYPES.map((mealType) => (
              <View key={mealType} style={styles.cellSlot}>
                <WeekGridCell
                  day={day}
                  mealType={mealType}
                  onAddPress={onAddPress}
                  onDayPress={onDayPress}
                />
              </View>
            ))}
            {/* The header's label already speaks the day's total. */}
            <View
              style={styles.kcalCell}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <ThemedText
                style={[
                  styles.kcalText,
                  {
                    color: day.calories > 0 ? theme.text : theme.textSecondary,
                  },
                ]}
              >
                {day.calories > 0 ? day.calories.toLocaleString("en-US") : "–"}
              </ThemedText>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
  },
  labelColumn: {
    width: GRID_LABEL_COLUMN_WIDTH,
    paddingLeft: Spacing.lg,
  },
  labelHeaderSpacer: {
    height: DAY_HEADER_HEIGHT,
  },
  rowLabel: {
    height: CELL_HEIGHT,
    marginTop: GRID_COLUMN_GAP,
    justifyContent: "center",
  },
  rowLabelText: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  kcalLabel: {
    height: KCAL_ROW_HEIGHT,
    marginTop: GRID_COLUMN_GAP,
    justifyContent: "center",
  },
  columns: {
    gap: GRID_COLUMN_GAP,
    paddingRight: Spacing.lg,
  },
  dayHeader: {
    height: DAY_HEADER_HEIGHT,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dayName: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  dayNum: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  cellSlot: {
    marginTop: GRID_COLUMN_GAP,
  },
  kcalCell: {
    height: KCAL_ROW_HEIGHT,
    marginTop: GRID_COLUMN_GAP,
    alignItems: "center",
    justifyContent: "center",
  },
  kcalText: {
    fontSize: 12,
    fontFamily: FontFamily.semiBold,
  },
});
