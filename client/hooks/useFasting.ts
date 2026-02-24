import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

interface FastingSchedule {
  id: number;
  userId: string;
  protocol: string;
  fastingHours: number;
  eatingHours: number;
  eatingWindowStart: string | null;
  eatingWindowEnd: string | null;
  isActive: boolean | null;
}

interface FastingLog {
  id: number;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  targetDurationHours: number;
  actualDurationMinutes: number | null;
  completed: boolean | null;
  note: string | null;
}

interface FastingStats {
  totalFasts: number;
  completedFasts: number;
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
  averageDurationMinutes: number;
}

export type { FastingSchedule, FastingLog, FastingStats };

export function useFastingSchedule() {
  return useQuery<FastingSchedule | null>({
    queryKey: ["/api/fasting/schedule"],
  });
}

export function useCurrentFast() {
  return useQuery<FastingLog | null>({
    queryKey: ["/api/fasting/current"],
    refetchInterval: 60000, // Refresh every minute for timer
  });
}

export function useFastingHistory() {
  return useQuery<{ logs: FastingLog[]; stats: FastingStats }>({
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
      return (await res.json()) as FastingSchedule;
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
      return (await res.json()) as FastingLog;
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
      return (await res.json()) as FastingLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fasting/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fasting/history"] });
    },
  });
}
