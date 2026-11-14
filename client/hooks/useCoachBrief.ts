import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import type { BriefForm, RenderedBrief } from "@shared/lib/opening-brief";

export const COACH_BRIEF_KEY = ["/api/coach/brief"] as const;

/**
 * The opening brief for a new Coach chat. Best effort: any failure (offline,
 * a 5xx, an older server without the endpoint) means no brief and the chat
 * works as before — the screen shows its normal empty state, no toast.
 */
export function useCoachBrief(
  form: BriefForm,
  enabled: boolean,
): { brief: RenderedBrief | null } {
  // Day-bucket in the device timezone, like useCoachContext.
  const tz = getDeviceTimezone();
  const { data } = useQuery<RenderedBrief>({
    queryKey: [...COACH_BRIEF_KEY, { form, tz }],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/coach/brief?form=${form}`,
        undefined,
        { headers: { "X-Timezone": tz } },
      );
      return res.json();
    },
    enabled,
    staleTime: 60 * 1000,
    meta: { silentError: true },
  });
  return { brief: data ?? null };
}
