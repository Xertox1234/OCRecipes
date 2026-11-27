import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { useWeekCalories } from "@/hooks/useWeekCalories";
import { GOALS_QUERY_KEY } from "@/hooks/useCalorieGoal";
import { useLocalToday } from "@/hooks/useLocalToday";
import type { WeekProgressBlock } from "@shared/schemas/coach-blocks";
import type { GoalsResponse } from "@/types/api";
import { liveGoals } from "./day-progress-utils";
import {
  liveWeek,
  weekBars,
  weekDates,
  weekSpoken,
  weekSummary,
  weekTitle,
} from "./week-progress-utils";

interface Props {
  block: WeekProgressBlock;
}

const CHART_HEIGHT = 72;

/**
 * Seven days of calories against the calorie goal, kept current (Coach
 * roadmap T3). The week is one read, kept with the day summaries, so a log
 * anywhere in the app (each one refreshes those) shows here too. The block's
 * snapshot stands in until it loads, or when it can't.
 */
const WeekProgress = React.memo(function WeekProgress({ block }: Props) {
  const { theme } = useTheme();
  const dates = useMemo(() => weekDates(block.endDate), [block.endDate]);
  const week = useWeekCalories(block.endDate);
  const goalsQuery = useQuery<GoalsResponse>({ queryKey: GOALS_QUERY_KEY });
  const today = useLocalToday();

  const liveCalories = liveWeek(week.data, week.isError, block.endDate);
  const liveGoal = liveGoals(goalsQuery.data)?.calories;
  // Live only when both reads came back and the latest of each worked;
  // otherwise the reply's week, all of it, so the caption is true.
  const live = !!liveCalories && !!liveGoal && !goalsQuery.isError;
  const calories =
    live && liveCalories ? liveCalories : block.snapshot.calories;
  const goal = live && liveGoal ? liveGoal : block.snapshot.calorieGoal;

  const bars = weekBars(calories, goal, dates, today);
  const summary = weekSummary(calories, goal, block.endDate === today);
  const title = weekTitle(block.endDate, today);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessible={true}
      accessibilityLabel={weekSpoken(title, bars, summary.text, live)}
      testID="week-progress"
    >
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <View style={styles.chart}>
        {/* The goal: a line across the bars at its height. */}
        <View
          style={[
            styles.goalLine,
            {
              bottom: summary.goalAt * CHART_HEIGHT,
              borderColor: theme.textSecondary,
            },
          ]}
        />
        {bars.map((bar) => (
          <View key={bar.date} style={styles.column}>
            <View
              style={[
                styles.bar,
                {
                  height: bar.height * CHART_HEIGHT,
                  // error, not warning: as on the day card, it is the one
                  // over-goal fill with 3:1 on the card in both themes.
                  backgroundColor: bar.over ? theme.error : theme.success,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.labels}>
        {bars.map((bar) => (
          <View key={bar.date} style={styles.column}>
            <Text
              style={[styles.value, { color: theme.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.2}
            >
              {bar.text}
            </Text>
            <Text
              style={[styles.day, { color: theme.textSecondary }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {bar.label}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[styles.summary, { color: theme.textSecondary }]}>
        {summary.text}
      </Text>
      <Text style={[styles.caption, { color: theme.textSecondary }]}>
        {live ? "Updates as you log" : "As of the Coach's reply"}
      </Text>
    </View>
  );
});

export default WeekProgress;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8, gap: 8 },
  title: { fontSize: 13, fontWeight: "600" },
  chart: {
    height: CHART_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  goalLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
  column: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 4 },
  labels: { flexDirection: "row", gap: 6 },
  value: { fontSize: 10, fontWeight: "500" },
  day: { fontSize: 10 },
  summary: { fontSize: 12 },
  caption: { fontSize: 11 },
});
