import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { hasConsented } from "@/lib/health-consent";
import { dietaryProfileQueryOptions } from "@/hooks/useDietaryProfile";

/**
 * The user's health-data consent: whether it is on record, and the two ways
 * to change it. The server stamps and clears the record; the client only
 * signals intent.
 */
export function useHealthConsent() {
  const queryClient = useQueryClient();
  const { data: consented = false } = useQuery({
    ...dietaryProfileQueryOptions,
    select: hasConsented,
  });

  /** Records the consent. Rejects when the request fails. */
  const grant = useCallback(async () => {
    await apiRequest("PUT", "/api/user/dietary-profile", {
      healthDataConsent: true,
    });
    await queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.dietaryProfile,
    });
  }, [queryClient]);

  /** Withdraws the consent and removes the health details. Rejects on failure. */
  const withdraw = useCallback(async () => {
    await apiRequest("POST", "/api/user/health-consent/withdraw");
    // Allergies, goals and body metrics feed most personalized queries. Not
    // awaited: the caller's confirmation should not wait on every refetch.
    void queryClient.invalidateQueries();
  }, [queryClient]);

  return { consented, grant, withdraw };
}
