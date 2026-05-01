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
      queryClient.invalidateQueries({ queryKey: PENDING_REMINDERS_KEY });
    },
  });

  return {
    acknowledge: mutation.mutateAsync,
    coachContext,
  };
}
