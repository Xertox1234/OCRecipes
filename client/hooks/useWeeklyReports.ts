import { useEffect } from "react";
import { AppState } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type {
  WeeklyReport,
  WeeklyReportList,
  WeeklyReportSettings,
} from "@shared/schemas/coach-weekly-report";

/**
 * Coach weekly report data. Keys are NOT QUERY_KEYS entries, so nothing here
 * is persisted across launches (App.tsx persists every QUERY_KEYS key).
 */
export const WEEKLY_REPORTS_KEY = ["/api/weekly-reports"] as const;
export const PENDING_WEEKLY_POPUP_KEY = [
  "/api/weekly-reports/pending-popup",
] as const;
export const WEEKLY_REPORT_SETTINGS_KEY = [
  "/api/weekly-reports/settings",
] as const;
export function weeklyReportKey(id: number) {
  return ["/api/weekly-reports", id] as const;
}

export function useWeeklyReports() {
  return useQuery<WeeklyReportList>({
    queryKey: WEEKLY_REPORTS_KEY,
    staleTime: 60_000,
  });
}

export function useWeeklyReport(id: number) {
  return useQuery<WeeklyReport>({
    queryKey: weeklyReportKey(id),
    enabled: id > 0,
  });
}

/** The report waiting for the in-app popup; re-checked when the app comes to the front. */
export function usePendingWeeklyPopup() {
  const queryClient = useQueryClient();
  const query = useQuery<{ report: WeeklyReport | null }>({
    queryKey: PENDING_WEEKLY_POPUP_KEY,
    staleTime: 0,
  });
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void queryClient.invalidateQueries({
          queryKey: PENDING_WEEKLY_POPUP_KEY,
        });
      }
    });
    return () => sub.remove();
  }, [queryClient]);
  return query;
}

function useReportMark(action: "seen" | "celebration-shown") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/weekly-reports/${id}/${action}`);
      return id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: weeklyReportKey(id) });
      void queryClient.invalidateQueries({ queryKey: WEEKLY_REPORTS_KEY });
    },
    // Background bookkeeping: a failure only means the "New" badge or the
    // celebration may show once more. Never worth an error toast.
    meta: { silentError: true },
  });
}

export function useMarkWeeklyReportSeen() {
  return useReportMark("seen");
}

export function useMarkCelebrationShown() {
  return useReportMark("celebration-shown");
}

/**
 * Claim the popup delivery. Resolves false on 409: a push already delivered
 * this report, so the sheet should close quietly.
 */
export function useMarkPopupShown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<boolean> => {
      try {
        await apiRequest("POST", `/api/weekly-reports/${id}/popup-shown`);
        return true;
      } catch (err) {
        if ((err as { status?: number }).status === 409) return false;
        throw err;
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: PENDING_WEEKLY_POPUP_KEY,
      });
    },
    meta: { silentError: true },
  });
}

export function useWeeklyReportSettings() {
  return useQuery<WeeklyReportSettings>({
    queryKey: WEEKLY_REPORT_SETTINGS_KEY,
  });
}

export function useUpdateWeeklyReportSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<WeeklyReportSettings>,
    ): Promise<WeeklyReportSettings> => {
      const res = await apiRequest(
        "PUT",
        "/api/weekly-reports/settings",
        patch,
      );
      return res.json();
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(WEEKLY_REPORT_SETTINGS_KEY, settings);
    },
  });
}
