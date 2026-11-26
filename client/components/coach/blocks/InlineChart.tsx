import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { InlineChart as InlineChartType } from "@shared/schemas/coach-blocks";

interface Props {
  block: InlineChartType;
}

const InlineChart = React.memo(function InlineChart({ block }: Props) {
  const { theme } = useTheme();

  if (block.chartType === "bar") {
    const maxValue = Math.max(...block.data.map((d) => d.value), 1);
    // The one accessible node speaks every bar, so the data is not lost to
    // a screen reader; `hit` is optional, and a bar without it is neither.
    const bars = block.data.map(
      (d) => `${d.label}: ${d.value}${hitWords(d.hit)}`,
    );
    const label = [block.title, ...bars, block.summary]
      .filter(Boolean)
      .join(". ");
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.backgroundSecondary },
        ]}
        accessibilityLabel={label}
        accessible={true}
      >
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <View style={styles.barRow} testID="inline-chart-bars">
          {block.data.map((d, i) => (
            <View key={i} style={styles.barCol}>
              <View style={styles.barWrapper}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${(d.value / maxValue) * 100}%`,
                      backgroundColor:
                        d.hit === true
                          ? theme.success
                          : d.hit === false
                            ? theme.error
                            : theme.textSecondary,
                    },
                  ]}
                />
              </View>
              {/* A symbol beside the colour, so hit and miss do not rest on
                  colour alone. The bar carries the colour; the small mark is
                  in the text colour, since the status tones are under 4.5:1
                  on this background in light mode. */}
              {d.hit !== undefined ? (
                <Text style={[styles.barMark, { color: theme.text }]}>
                  {d.hit ? "✓" : "✗"}
                </Text>
              ) : null}
              <Text
                style={[styles.barLabel, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {d.label}
              </Text>
            </View>
          ))}
        </View>
        {block.summary && (
          <Text style={[styles.summary, { color: theme.textSecondary }]}>
            {block.summary}
          </Text>
        )}
      </View>
    );
  }

  if (block.chartType === "stat_row") {
    const statSummary = block.data
      .map((d) => `${d.label}: ${d.value}`)
      .join(", ");

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.backgroundSecondary },
        ]}
        accessibilityLabel={`${block.title}. ${statSummary}`}
        accessible={true}
      >
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <View style={styles.statRow}>
          {block.data.map((d, i) => (
            <View key={i} style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.link }]}>
                {d.value}
              </Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
                {d.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  // progress type
  const datum = block.data[0];
  const pct = datum?.target
    ? Math.min((datum.value / datum.target) * 100, 100)
    : 0;
  const progressLabel = datum
    ? `${block.title}. ${datum.value} of ${datum.target ?? "?"}`
    : block.title;
  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessibilityLabel={`${progressLabel}${block.summary ? `. ${block.summary}` : ""}`}
      accessible={true}
    >
      <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
      <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${pct}%`, backgroundColor: theme.success },
          ]}
        />
      </View>
      {block.summary && (
        <Text style={[styles.summary, { color: theme.textSecondary }]}>
          {block.summary}
        </Text>
      )}
    </View>
  );
});

function hitWords(hit: boolean | undefined): string {
  if (hit === true) return ", on target";
  if (hit === false) return ", missed";
  return "";
}

export default InlineChart;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8 },
  title: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  // minHeight, not height: at the large text sizes the labels need room.
  barRow: {
    flexDirection: "row",
    gap: 4,
    minHeight: 80,
    alignItems: "flex-end",
  },
  barCol: { flex: 1, alignItems: "center" },
  barWrapper: { width: "100%", height: 60, justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 4, minHeight: 4 },
  barMark: { fontSize: 10, marginTop: 2 },
  barLabel: { fontSize: 9, marginTop: 2 },
  summary: { fontSize: 11, marginTop: 8, textAlign: "center" },
  statRow: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "700" },
  statLabel: { fontSize: 10, marginTop: 2 },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
});
