import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { AllergenCheckResult } from "@shared/types/allergen-check";

/**
 * TanStack Query hook that checks a list of ingredient names against the
 * authenticated user's declared allergies.
 *
 * Returns allergen matches and safe substitution suggestions.
 * Skips the request when the ingredient list is empty.
 *
 * The query key is stabilized via JSON serialization so callers don't need
 * to memoize the input array to prevent unnecessary refetches.
 */
export function useAllergenCheck(ingredientNames: string[]) {
  // Stabilize key — array identity changes don't trigger refetch
  const stableKey = useMemo(
    () => JSON.stringify(ingredientNames),
    [ingredientNames],
  );

  return useQuery<AllergenCheckResult>({
    queryKey: ["/api/allergen-check", stableKey],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/allergen-check", {
        ingredients: ingredientNames,
      });
      return res.json();
    },
    enabled: ingredientNames.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes — allergy profile rarely changes
  });
}
