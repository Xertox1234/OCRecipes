import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { QueryErrorMeta } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { getDeviceTimezone } from "@/lib/timezone";
import type { DailySummaryResponse } from "@/types/api";

/**
 * The day's logged-intake summary — today when `date` is omitted, else that
 * local `YYYY-MM-DD` day. The one owner of this endpoint's key shape and its
 * `X-Timezone` header (without the header, non-UTC users get UTC-bucketed
 * days). The date is its own key element after `QUERY_KEYS.dailySummary`, so
 * one `invalidateQueries({ queryKey: QUERY_KEYS.dailySummary })` (prefix
 * match) reaches today's and every dated entry.
 */
export function useDailySummary(
  date?: string,
  options?: { meta?: QueryErrorMeta },
) {
  return useQuery<DailySummaryResponse>({
    queryKey: date
      ? [...QUERY_KEYS.dailySummary, date]
      : QUERY_KEYS.dailySummary,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        date ? `/api/daily-summary?date=${date}` : "/api/daily-summary",
        undefined,
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return res.json() as Promise<DailySummaryResponse>;
    },
    meta: options?.meta,
  });
}
