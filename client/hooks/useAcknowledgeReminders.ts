import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { CoachContextItem, ReminderType } from "@shared/types/reminders";
import { QUERY_KEY as PENDING_REMINDERS_KEY } from "./usePendingReminders";
import { COACH_BRIEF_KEY } from "./useCoachBrief";

export function useAcknowledgeReminders() {
  const queryClient = useQueryClient();
  const [coachContext, setCoachContext] = useState<CoachContextItem[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reminders/acknowledge");
      return res.json() as Promise<{
        acknowledged: number;
        coachContext: CoachContextItem[];
      }>;
    },
    onSuccess: (data) => {
      setCoachContext(data.coachContext);
      void queryClient.invalidateQueries({ queryKey: PENDING_REMINDERS_KEY });
      // A cleared reminder must not lead the next new chat's brief.
      void queryClient.invalidateQueries({ queryKey: COACH_BRIEF_KEY });
    },
    // Judgment call, not a double-toast avoidance: every call site treats a
    // failure here as inconsequential best-effort background housekeeping
    // (it silently retries on the next message send — see each caller's
    // `.catch(() => { hasAcknowledgedRef.current = false; ... })`). Showing
    // a generic "Something went wrong" toast right after the user just
    // successfully sent a message would be confusing, not helpful.
    meta: { silentError: true },
  });

  // The brief's "Not today": clear one reminder type only, then refresh the
  // tab dot and the brief like a full acknowledge does.
  const acknowledgeType = async (type: ReminderType) => {
    await apiRequest("POST", "/api/reminders/acknowledge-type", { type });
    void queryClient.invalidateQueries({ queryKey: PENDING_REMINDERS_KEY });
    void queryClient.invalidateQueries({ queryKey: COACH_BRIEF_KEY });
  };

  return {
    acknowledge: mutation.mutateAsync,
    acknowledgeType,
    coachContext,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
