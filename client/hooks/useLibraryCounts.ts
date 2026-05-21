import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRefreshOnFocus } from "@/hooks/useRefreshOnFocus";
import type { LibraryCountsResponse } from "@shared/schemas/profile-hub";

export function useLibraryCounts() {
  const query = useQuery<LibraryCountsResponse>({
    queryKey: ["/api/profile/library-counts"],
    staleTime: 30_000,
    gcTime: 300_000,
    placeholderData: keepPreviousData,
  });

  useRefreshOnFocus(() => {
    void query.refetch();
  });

  return query;
}
