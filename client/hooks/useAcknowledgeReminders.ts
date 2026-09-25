import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { CoachContextItem } from "@shared/types/reminders";
import { QUERY_KEY as PENDING_REMINDERS_KEY } from "./usePendingReminders";

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
    },
    // Judgment call, not a double-toast avoidance: every call site treats a
    // failure here as inconsequential best-effort background housekeeping
    // (it silently retries on the next message send — see each caller's
    // `.catch(() => { hasAcknowledgedRef.current = false; ... })`). Showing
    // a generic "Something went wrong" toast right after the user just
    // successfully sent a message would be confusing, not helpful.
    meta: { silentError: true },
  });

  return {
    acknowledge: mutation.mutateAsync,
    coachContext,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
