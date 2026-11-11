import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import type { WeeklyReport } from "@shared/schemas/coach-weekly-report";
import { useWeeklyReport, useWeeklyReports } from "@/hooks/useWeeklyReports";
import type { ProfileScreenNavigationProp } from "@/types/navigation";
import {
  chartSeries,
  formatWeekRange,
  shouldShowYourWeek,
} from "./weekly-report-utils";

const SPARK_HEIGHT = 28;

/** The profile's "Your week" card for the newest report. */
export function YourWeekCard({
  report,
  onOpen,
}: {
  report: WeeklyReport;
  onOpen: () => void;
}) {
  const { theme } = useTheme();
  const unseen = report.seenAt === null;
  const protein = chartSeries(report.facts, "protein");
  const values = protein
    ? protein.map((b) => ({ v: b.value ?? 0, on: b.met }))
    : report.facts.days.map((d) => ({ v: d.meals, on: d.meals > 0 }));
  const max = Math.max(...values.map((x) => x.v), 1);
  const range = formatWeekRange(report.weekStart, report.weekEnd);

  return (
    <PressableScale
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Your week, ${range}${unseen ? ", new" : ""}. ${report.content.headline} Read your week.`}
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.top}>
        <ThemedText style={[styles.eyebrow, { color: theme.textSecondary }]}>
          Your week · {range}
        </ThemedText>
        {unseen && (
          <View style={[styles.badge, { backgroundColor: theme.accentSolid }]}>
            <ThemedText style={[styles.badgeText, { color: theme.buttonText }]}>
              New
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText style={styles.headline} numberOfLines={2}>
        {report.content.headline}
      </ThemedText>
      <View style={styles.spark}>
        {values.map((x, i) => (
          <View
            key={i}
            style={[
              styles.sparkBar,
              {
                height: Math.max(3, (x.v / max) * SPARK_HEIGHT),
                backgroundColor: x.on ? theme.link : theme.backgroundTertiary,
              },
            ]}
          />
        ))}
      </View>
      <ThemedText style={[styles.cta, { color: theme.link }]}>
        Read your week
      </ThemedText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  badge: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  badgeText: { fontFamily: FontFamily.semiBold, fontSize: 11 },
  headline: { fontFamily: FontFamily.semiBold, fontSize: 16, lineHeight: 22 },
  spark: {
    height: SPARK_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  sparkBar: { flex: 1, borderRadius: 2 },
  cta: { fontFamily: FontFamily.semiBold, fontSize: 14, minHeight: 24 },
});

/** Profile entry point: the newest report's card, when it should show. */
export function ProfileWeekCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { data } = useWeeklyReports();
  const newestItem = data?.reports[0];
  const show = shouldShowYourWeek(newestItem, new Date());
  const { data: report } = useWeeklyReport(
    show && newestItem ? newestItem.id : 0,
  );
  if (!show || !report) return null;
  return (
    <View style={style}>
      <YourWeekCard
        report={report}
        onOpen={() => navigation.navigate("WeeklyReport", { id: report.id })}
      />
    </View>
  );
}
