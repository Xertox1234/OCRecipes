import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRefreshOnFocus } from "@/hooks/useRefreshOnFocus";
import type { ProfileWidgetsResponse } from "@shared/schemas/profile-hub";

export function useProfileWidgets() {
  const query = useQuery<ProfileWidgetsResponse>({
    queryKey: ["/api/profile/widgets"],
    staleTime: 60_000,
    gcTime: 300_000,
    placeholderData: keepPreviousData,
  });

  useRefreshOnFocus(() => {
    void query.refetch();
  });

  return query;
}
