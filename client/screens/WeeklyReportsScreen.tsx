import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useBottomBudget } from "@/hooks/useBottomBudget";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { useToast } from "@/context/ToastContext";
import {
  useUpdateWeeklyReportSettings,
  useWeeklyReport,
  useWeeklyReportSettings,
  useWeeklyReports,
} from "@/hooks/useWeeklyReports";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import type { WeeklyReportSettings } from "@shared/schemas/coach-weekly-report";
import { TrendsCard } from "@/components/weekly-report/TrendsCard";
import { formatWeekRange } from "@/components/weekly-report/weekly-report-utils";

type Nav = NativeStackNavigationProp<ProfileStackParamList, "WeeklyReports">;

const SETTINGS: {
  key: keyof WeeklyReportSettings;
  label: string;
  description: string;
}[] = [
  {
    key: "reportEnabled",
    label: "Weekly report",
    description: "Coach looks back at your week every Sunday evening",
  },
  {
    key: "pushEnabled",
    label: "Push notification",
    description: "Tell me when it's ready. Reports still save here when off",
  },
];

function SettingsCard() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { data } = useWeeklyReportSettings();
  const { mutate, isPending } = useUpdateWeeklyReportSettings();
  return (
    <View
      style={[styles.settings, { backgroundColor: theme.backgroundSecondary }]}
    >
      {SETTINGS.map((s, i) => (
        <View key={s.key}>
          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <ThemedText style={styles.settingLabel}>{s.label}</ThemedText>
              <ThemedText
                style={[styles.small, { color: theme.textSecondary }]}
              >
                {s.description}
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel={s.label}
              accessibilityHint={s.description}
              value={data?.[s.key] ?? true}
              disabled={
                !data ||
                isPending ||
                (s.key === "pushEnabled" && data.reportEnabled === false)
              }
              onValueChange={(v) => {
                haptics.selection();
                mutate(
                  { [s.key]: v },
                  {
                    onError: () =>
                      toast.error("Couldn't change that. Please try again."),
                  },
                );
              }}
              trackColor={{
                false: withOpacity(theme.textSecondary, 0.3),
                true: theme.link,
              }}
              thumbColor={
                Platform.OS === "android" ? theme.buttonText : undefined
              }
            />
          </View>
          {i < SETTINGS.length - 1 && (
            <View
              style={[
                styles.divider,
                { backgroundColor: withOpacity(theme.textSecondary, 0.12) },
              ]}
            />
          )}
        </View>
      ))}
    </View>
  );
}

export default function WeeklyReportsScreen() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<Nav>();
  const headerInset = useHeaderContentInset(Spacing.lg);
  const bottomBudget = useBottomBudget();
  const { data, isError, refetch } = useWeeklyReports();
  const newestId = data?.reports[0]?.id ?? 0;
  const { data: newest } = useWeeklyReport(newestId);
  const reports = data?.reports ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: theme.backgroundDefault }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: headerInset, paddingBottom: bottomBudget + Spacing.xl },
      ]}
    >
      {data && (
        <TrendsCard
          trends={data.trends}
          trendLine={newest?.content.trendLine ?? null}
        />
      )}

      {isError && (
        <View style={styles.center}>
          <ThemedText style={{ color: theme.textSecondary }}>
            {"Couldn't load your reports."}
          </ThemedText>
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading your reports"
            style={styles.link}
          >
            <ThemedText style={[styles.linkText, { color: theme.link }]}>
              Retry
            </ThemedText>
          </Pressable>
        </View>
      )}

      {reports.length > 0 && (
        <ThemedText
          accessibilityRole="header"
          style={[styles.heading, { color: theme.textSecondary }]}
        >
          Every week
        </ThemedText>
      )}
      {reports.map((r) => {
        const range = formatWeekRange(r.weekStart, r.weekEnd);
        return (
          <PressableScale
            key={r.id}
            onPress={() => {
              haptics.selection();
              navigation.navigate("WeeklyReport", { id: r.id });
            }}
            accessibilityRole="button"
            accessibilityLabel={`${range}${r.seen ? "" : ", new"}. ${r.headline}`}
            style={[
              styles.row,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <View style={styles.rowTop}>
              <ThemedText
                style={[styles.range, { color: theme.textSecondary }]}
              >
                {range}
              </ThemedText>
              {!r.seen && (
                <View
                  style={[styles.badge, { backgroundColor: theme.accentSolid }]}
                >
                  <ThemedText
                    style={[styles.badgeText, { color: theme.buttonText }]}
                  >
                    New
                  </ThemedText>
                </View>
              )}
            </View>
            <ThemedText style={styles.rowHeadline}>{r.headline}</ThemedText>
          </PressableScale>
        );
      })}

      <ThemedText
        accessibilityRole="header"
        style={[styles.heading, { color: theme.textSecondary }]}
      >
        Report settings
      </ThemedText>
      <SettingsCard />
      <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
        Newest first. Reports are kept for as long as your account is.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
  center: { alignItems: "center", gap: Spacing.sm },
  heading: {
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: Spacing.sm,
  },
  row: {
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    gap: 4,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  range: { fontFamily: FontFamily.semiBold, fontSize: 13 },
  rowHeadline: {
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
    lineHeight: 21,
  },
  badge: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  badgeText: { fontFamily: FontFamily.semiBold, fontSize: 11 },
  settings: { borderRadius: BorderRadius.lg, overflow: "hidden" },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: Spacing.md,
  },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { fontFamily: FontFamily.medium, fontSize: 15 },
  small: { fontSize: 12, lineHeight: 17 },
  divider: { height: 1, marginLeft: Spacing.md },
  link: { minHeight: 44, minWidth: 44, justifyContent: "center" },
  linkText: { fontFamily: FontFamily.semiBold, fontSize: 14 },
});
