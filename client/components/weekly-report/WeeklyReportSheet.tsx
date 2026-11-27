import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as Notifications from "expo-notifications";
import { CenteredDialog } from "@/components/CenteredDialog";
import { Button } from "@/components/Button";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  useMarkPopupShown,
  usePendingWeeklyPopup,
  useWeeklyReport,
} from "@/hooks/useWeeklyReports";
import { openWeeklyReport as openReport } from "./open-weekly-report";
import { Spacing } from "@/constants/theme";
import { formatWeekRange, shouldShowPopup } from "./weekly-report-utils";

/** The report id in a weekly-report push's data, or null. */
function weeklyReportIdFrom(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: unknown; reportId?: unknown };
  if (d.type !== "weekly-report") return null;
  return typeof d.reportId === "number" &&
    Number.isInteger(d.reportId) &&
    d.reportId > 0
    ? d.reportId
    : null;
}

/**
 * The Sunday popup. Mounted once inside the signed-in app. Shows the report a
 * push just announced while the app was open, or the pending report no push
 * will announce — claiming the popup delivery first, so a push and a popup
 * never both reach the person (a 409 claim closes it quietly).
 */
export function WeeklyReportPopupHost() {
  const { theme } = useTheme();
  // dataUpdatedAt changes on every fetch, even when structural sharing keeps
  // the same data: it is what lets a failed claim retry on the next
  // foreground (coach audit 2026-11-24, L60).
  const { data: pendingData, dataUpdatedAt: pendingFetchedAt } =
    usePendingWeeklyPopup();
  const { mutateAsync: claimPopup } = useMarkPopupShown();
  const [foregroundPush, setForegroundPush] = useState<{
    reportId: number;
  } | null>(null);
  const [visibleId, setVisibleId] = useState<number | null>(null);
  const shownIds = useRef(new Set<number>());

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const id = weeklyReportIdFrom(n.request.content.data);
      if (id !== null) setForegroundPush({ reportId: id });
    });
    return () => sub.remove();
  }, []);

  const pending = pendingData?.report ?? null;

  const { data: report, isError: reportFailed } = useWeeklyReport(
    visibleId ?? 0,
  );
  // The dialog, and its close, render only once the report has loaded. A
  // report that fails to load (offline, a 404) does not hold the host, or no
  // later popup could show until the app restarts (coach audit 2026-11-24,
  // L82). Its id stays in shownIds, so it is not offered again this session;
  // the next popup's id replaces it.
  const showing = visibleId !== null && !reportFailed;

  useEffect(() => {
    if (showing) return;
    const id = shouldShowPopup({
      pending: pending ? { id: pending.id } : null,
      foregroundPush,
      alreadyShownIds: shownIds.current,
    });
    if (id === null) return;
    shownIds.current.add(id);
    if (foregroundPush?.reportId === id) {
      // The push already holds the delivery claim.
      setForegroundPush(null);
      setVisibleId(id);
      return;
    }
    void claimPopup(id)
      .then((claimed) => {
        if (claimed) setVisibleId(id);
      })
      .catch(() => {
        // Offline or server error: try again on the next foreground, when
        // the pending report is fetched again (pendingFetchedAt changes).
        shownIds.current.delete(id);
      });
  }, [pending, pendingFetchedAt, foregroundPush, showing, claimPopup]);

  const close = useCallback(() => setVisibleId(null), []);

  if (!showing || !report) return null;
  const range = formatWeekRange(report.weekStart, report.weekEnd);

  return (
    <CenteredDialog
      visible
      onRequestClose={close}
      backdropLabel="Close weekly report"
      dialogLabel="Your weekly report is ready"
      icon="trending-up"
      title={`Your week is ready · ${range}`}
      message={report.content.headline}
    >
      <ThemedText style={[styles.note, { color: theme.textSecondary }]}>
        Your coach looked back at the week.
      </ThemedText>
      <View style={styles.actions}>
        <Button
          onPress={() => {
            close();
            openReport(report.id);
          }}
        >
          Read my week
        </Button>
        <Button variant="ghost" onPress={close}>
          {"Later — it's saved in your profile"}
        </Button>
      </View>
    </CenteredDialog>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  actions: { gap: Spacing.sm, marginTop: Spacing.md, alignSelf: "stretch" },
});
