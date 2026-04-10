import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { InlineChart as InlineChartType } from "@shared/schemas/coach-blocks";

interface Props {
  block: InlineChartType;
}

export default function InlineChart({ block }: Props) {
  const { theme } = useTheme();

  if (block.chartType === "bar") {
    const maxValue = Math.max(...block.data.map((d) => d.value), 1);
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]} accessibilityLabel={`${block.title}. ${block.summary ?? ""}`}>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <View style={styles.barRow}>
          {block.data.map((d, i) => (
            <View key={i} style={styles.barCol}>
              <View style={styles.barWrapper}>
                <View style={[styles.bar, { height: `${(d.value / maxValue) * 100}%`, backgroundColor: d.hit ? theme.success : theme.error }]} />
              </View>
              <Text style={[styles.barLabel, { color: theme.textSecondary }]}>{d.label}</Text>
            </View>
          ))}
        </View>
        {block.summary && <Text style={[styles.summary, { color: theme.textSecondary }]}>{block.summary}</Text>}
      </View>
    );
  }

  if (block.chartType === "stat_row") {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <View style={styles.statRow}>
          {block.data.map((d, i) => (
            <View key={i} style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.link }]}>{d.value}</Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{d.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  // progress type
  const datum = block.data[0];
  const pct = datum?.target ? Math.min((datum.value / datum.target) * 100, 100) : 0;
  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
      <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: theme.success }]} />
      </View>
      {block.summary && <Text style={[styles.summary, { color: theme.textSecondary }]}>{block.summary}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  title: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  barRow: { flexDirection: "row", gap: 4, height: 80, alignItems: "flex-end" },
  barCol: { flex: 1, alignItems: "center" },
  barWrapper: { width: "100%", height: 60, justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 4, minHeight: 4 },
  barLabel: { fontSize: 9, marginTop: 4 },
  summary: { fontSize: 11, marginTop: 8, textAlign: "center" },
  statRow: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "700" },
  statLabel: { fontSize: 10, marginTop: 2 },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
});
