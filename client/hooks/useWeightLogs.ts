import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface WeightLog {
  id: number;
  userId: string;
  weight: string;
  source: string;
  note: string | null;
  loggedAt: string;
}

export interface WeightTrend {
  avg7Day: number | null;
  avg30Day: number | null;
  weeklyRateOfChange: number | null;
  projectedGoalDate: string | null;
  currentWeight: number | null;
  entries: number;
  goalWeight: number | null;
}

export function useWeightLogs(options?: {
  from?: string;
  to?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();

  return useQuery<WeightLog[]>({
    queryKey: [qs ? `/api/weight?${qs}` : "/api/weight"],
  });
}

export function useWeightTrend() {
  return useQuery<WeightTrend>({
    queryKey: ["/api/weight/trend"],
  });
}

export function useLogWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      weight: number;
      source?: string;
      note?: string;
    }) => {
      const res = await apiRequest("POST", "/api/weight", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weight"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weight/trend"] });
    },
  });
}

export function useDeleteWeightLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/weight/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weight"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weight/trend"] });
    },
  });
}

export function useSetGoalWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (goalWeight: number | null) => {
      const res = await apiRequest("PUT", "/api/goals/weight", { goalWeight });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weight/trend"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}
