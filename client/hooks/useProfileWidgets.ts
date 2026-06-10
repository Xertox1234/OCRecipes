import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import { useRefreshOnFocus } from "@/hooks/useRefreshOnFocus";
import type { ProfileWidgetsResponse } from "@shared/schemas/profile-hub";

export function useProfileWidgets() {
  // Day-bucket "today" in the device timezone — without the header the server
  // falls back to UTC and the widget disagrees with the Home screen's total.
  const tz = getDeviceTimezone();
  const query = useQuery<ProfileWidgetsResponse>({
    queryKey: ["/api/profile/widgets", { tz }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/profile/widgets", undefined, {
        headers: { "X-Timezone": tz },
      });
      return res.json() as Promise<ProfileWidgetsResponse>;
    },
    staleTime: 60_000,
    gcTime: 300_000,
    placeholderData: keepPreviousData,
  });

  useRefreshOnFocus(() => {
    void query.refetch();
  });

  return query;
}
