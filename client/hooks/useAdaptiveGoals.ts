import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface AdaptiveGoalRecommendation {
  previousCalories: number;
  newCalories: number;
  previousProtein: number;
  newProtein: number;
  previousCarbs: number;
  newCarbs: number;
  previousFat: number;
  newFat: number;
  reason: string;
  weightTrendRate: number | null;
  explanation: string;
}

interface AdaptiveGoalStatus {
  hasRecommendation: boolean;
  recommendation: AdaptiveGoalRecommendation | null;
}

export function useAdaptiveGoals(enabled: boolean) {
  return useQuery<AdaptiveGoalStatus>({
    queryKey: ["/api/goals/adaptive"],
    enabled,
  });
}

export function useAcceptAdaptiveGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/goals/adaptive/accept");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals/adaptive"] });
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] });
    },
  });
}

export function useDismissAdaptiveGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/goals/adaptive/dismiss");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals/adaptive"] });
    },
  });
}
