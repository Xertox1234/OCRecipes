import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { PressableScale } from "@/components/PressableScale";
import { openWeeklyReport } from "@/components/weekly-report/open-weekly-report";
import type { WeeklyReportBlock } from "@shared/schemas/coach-blocks";
import {
  reportEyebrow,
  reportSpoken,
  reportStats,
} from "./weekly-report-card-utils";

interface Props {
  block: WeeklyReportBlock;
}

/**
 * The user's weekly report in the chat (Coach roadmap A3): the week, its
 * headline and three counts, read by the server from the stored report. A
 * report never changes once written, so the card needs no fresh read; a tap
 * opens the full report on the Profile tab.
 */
const WeeklyReportCard = React.memo(function WeeklyReportCard({
  block,
}: Props) {
  const { theme } = useTheme();
  return (
    <PressableScale
      onPress={() => openWeeklyReport(block.reportId)}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={reportSpoken(block)}
      testID="weekly-report-card"
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
    >
      <Text
        style={[styles.eyebrow, { color: theme.textSecondary }]}
        maxFontSizeMultiplier={1.2}
      >
        {reportEyebrow(block)}
      </Text>
      <Text
        style={[styles.headline, { color: theme.text }]}
        maxFontSizeMultiplier={1.2}
      >
        {block.headline}
      </Text>
      <View style={styles.stats}>
        {reportStats(block).map((stat) => (
          <Text
            key={stat}
            style={[styles.stat, { color: theme.text }]}
            maxFontSizeMultiplier={1.2}
          >
            {stat}
          </Text>
        ))}
      </View>
      <Text
        style={[styles.cta, { color: theme.link }]}
        maxFontSizeMultiplier={1.2}
      >
        Read your week
      </Text>
    </PressableScale>
  );
});

export default WeeklyReportCard;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8, gap: 6 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  headline: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  stats: { gap: 2 },
  stat: { fontSize: 13 },
  cta: { fontSize: 14, fontWeight: "600", minHeight: 24, marginTop: 2 },
});
