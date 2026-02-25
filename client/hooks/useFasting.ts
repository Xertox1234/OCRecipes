import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type {
  ApiFastingSchedule,
  ApiFastingLog,
  FastingStats,
} from "@shared/types/fasting";

export type {
  ApiFastingSchedule,
  ApiFastingLog,
  FastingStats,
} from "@shared/types/fasting";

export function useFastingSchedule() {
  return useQuery<ApiFastingSchedule | null>({
    queryKey: ["/api/fasting/schedule"],
  });
}

export function useCurrentFast() {
  return useQuery<ApiFastingLog | null>({
    queryKey: ["/api/fasting/current"],
    refetchInterval: 60000, // Refresh every minute for timer
  });
}

export function useFastingHistory() {
  return useQuery<{ logs: ApiFastingLog[]; stats: FastingStats }>({
    queryKey: ["/api/fasting/history"],
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      protocol: string;
      fastingHours: number;
      eatingHours: number;
      eatingWindowStart?: string;
      eatingWindowEnd?: string;
    }) => {
      const res = await apiRequest("PUT", "/api/fasting/schedule", data);
      return (await res.json()) as ApiFastingSchedule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fasting/schedule"] });
    },
  });
}

export function useStartFast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fasting/start");
      return (await res.json()) as ApiFastingLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fasting/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fasting/history"] });
    },
  });
}

export function useEndFast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (note?: string) => {
      const res = await apiRequest("POST", "/api/fasting/end", { note });
      return (await res.json()) as ApiFastingLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fasting/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fasting/history"] });
    },
  });
}
