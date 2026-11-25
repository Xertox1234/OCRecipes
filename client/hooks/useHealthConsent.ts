import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  coachNotesOff,
  hasConsented,
  type CoachNotesChoice,
} from "@/lib/health-consent";
import { dietaryProfileQueryOptions } from "@/hooks/useDietaryProfile";
import { clearScheduledCoachReminders } from "@/hooks/useNotebookNotifications";

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

  /**
   * Withdraws the consent and removes the health details. `coachNotes` is the
   * user's choice for the notes Coach saved; without it the server keeps
   * them. Rejects on failure.
   */
  const withdraw = useCallback(
    async (coachNotes?: CoachNotesChoice) => {
      await apiRequest(
        "POST",
        "/api/user/health-consent/withdraw",
        coachNotes ? { coachNotes } : undefined,
      );
      // Allergies, goals and body metrics feed most personalized queries. Not
      // awaited: the caller's confirmation should not wait on every refetch.
      // Commitment reminders this device scheduled carry the note's text and
      // would still fire. They are the only local notifications the app
      // schedules, and the helper never throws.
      void clearScheduledCoachReminders();
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  return { consented, grant, withdraw };
}

/**
 * Whether Coach's notes are off for this user (no health-data consent the
 * server accepts). False while the profile is loading or failed to load.
 */
export function useCoachNotesOff(): boolean {
  const { data, isSuccess } = useQuery(dietaryProfileQueryOptions);
  return coachNotesOff(data, isSuccess);
}
