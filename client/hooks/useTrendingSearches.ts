import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface TrendingSearchesResponse {
  terms: string[];
}

/** Fetches popularity-derived trending search terms. Pass `enabled = isOpen`
 *  so it only fires when the search drawer is open (it rides the shared
 *  instructionsRateLimit and must not run on every Home mount). */
export function useTrendingSearches(enabled: boolean) {
  return useQuery<TrendingSearchesResponse>({
    queryKey: ["/api/recipes/trending"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/recipes/trending");
      return res.json() as Promise<TrendingSearchesResponse>;
    },
    enabled,
    staleTime: 1000 * 60 * 30, // 30 min — trending changes slowly
  });
}
