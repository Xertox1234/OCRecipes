import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { healthKitAvailable } from "@/lib/healthkit";

export interface HealthKitSyncSetting {
  id: number;
  userId: string;
  dataType: string;
  enabled: boolean;
  lastSyncAt: string | null;
  syncDirection: string;
}

export function useHealthKitSettings() {
  return useQuery<HealthKitSyncSetting[]>({
    queryKey: ["/api/healthkit/settings"],
    enabled: healthKitAvailable,
  });
}

export function useUpdateHealthKitSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      settings: {
        dataType: string;
        enabled: boolean;
        syncDirection?: string;
      }[],
    ) => {
      const res = await apiRequest("PUT", "/api/healthkit/settings", {
        settings,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/healthkit/settings"] });
    },
  });
}

export function useSyncHealthKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      weights?: { weight: number; date: string }[];
      workouts?: {
        name: string;
        type: string;
        durationMinutes: number;
        caloriesBurned: number;
        date: string;
      }[];
    }) => {
      const res = await apiRequest("POST", "/api/healthkit/sync", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weight"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
    },
  });
}

export { healthKitAvailable };
