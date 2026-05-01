import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { CoachContextItem } from "@shared/types/reminders";

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
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/pending"] });
    },
  });

  return {
    acknowledge: mutation.mutateAsync,
    coachContext,
  };
}
