import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { CoachNotebookEntry } from "@shared/schema";

export interface CoachContextData {
  goals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } | null;
  todayIntake: {
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
  } | null;
  dietaryProfile: {
    dietType: string | null;
    allergies: string[] | null;
    dislikes: string[] | null;
  } | null;
  notebook: CoachNotebookEntry[];
  dueCommitments: CoachNotebookEntry[];
  suggestions: string[];
}

export function useCoachContext(enabled: boolean) {
  return useQuery<CoachContextData>({
    queryKey: ["/api/coach/context"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/coach/context");
      return res.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
