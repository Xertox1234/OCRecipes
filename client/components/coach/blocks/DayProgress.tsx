import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { useDailySummary } from "@/hooks/useDailySummary";
import { GOALS_QUERY_KEY } from "@/hooks/useCalorieGoal";
import { useLocalToday } from "@/hooks/useLocalToday";
import type { DayProgressBlock } from "@shared/schemas/coach-blocks";
import type { GoalsResponse } from "@/types/api";
import {
  dayProgressRows,
  dayProgressSpoken,
  dayProgressTitle,
  liveGoals,
  liveTotals,
} from "./day-progress-utils";

interface Props {
  block: DayProgressBlock;
}

/**
 * A day's totals against the goals, kept current (Coach roadmap T3). It reads
 * the same day summary and goals as Home, so a log or a goals change anywhere
 * in the app (each one refreshes those queries) shows here too. The block's
 * snapshot stands in until they load, or when they can't.
 */
const DayProgress = React.memo(function DayProgress({ block }: Props) {
  const { theme } = useTheme();
  const summary = useDailySummary(block.date);
  const goalsQuery = useQuery<GoalsResponse>({ queryKey: GOALS_QUERY_KEY });

  const totals = liveTotals(summary.data);
  const goals = liveGoals(goalsQuery.data);
  // Live only when both reads came back and the latest of each worked;
  // otherwise the reply's numbers, all of them, so the caption is true.
  const live = !!totals && !!goals && !summary.isError && !goalsQuery.isError;
  const rows =
    live && totals && goals
      ? dayProgressRows(totals, goals)
      : dayProgressRows(block.snapshot.totals, block.snapshot.goals);
  const today = useLocalToday();
  const title = dayProgressTitle(block.date, today);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessible={true}
      accessibilityLabel={dayProgressSpoken(title, rows, live)}
      testID="day-progress"
    >
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.label, { color: theme.text }]}>
              {row.label}
            </Text>
            <Text style={[styles.value, { color: theme.textSecondary }]}>
              {row.text}
              {row.over ? " · over" : ""}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${row.fraction * 100}%`,
                  // error, not warning: warning is under 3:1 on the
                  // track in light mode; error passes in both.
                  backgroundColor: row.over ? theme.error : theme.success,
                },
              ]}
            />
          </View>
        </View>
      ))}
      <Text style={[styles.caption, { color: theme.textSecondary }]}>
        {live ? "Updates as you log" : "As of the Coach's reply"}
      </Text>
    </View>
  );
});

export default DayProgress;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8, gap: 8 },
  title: { fontSize: 13, fontWeight: "600" },
  row: { gap: 4 },
  rowText: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  label: { fontSize: 12, fontWeight: "500" },
  value: { fontSize: 12 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
  caption: { fontSize: 11 },
});
