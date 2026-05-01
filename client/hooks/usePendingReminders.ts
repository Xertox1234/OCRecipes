import { useEffect } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export const QUERY_KEY = ["/api/reminders/pending"] as const;

export function usePendingReminders(): { hasPending: boolean } {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ hasPending: boolean }>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reminders/pending");
      return res.json();
    },
  });

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  return { hasPending: data?.hasPending ?? false };
}
