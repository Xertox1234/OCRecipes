import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
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
  // Day-bucket "today's intake" in the device timezone — without the header
  // the server falls back to UTC and the panel disagrees with Home.
  const tz = getDeviceTimezone();
  return useQuery<CoachContextData>({
    queryKey: ["/api/coach/context", { tz }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/coach/context", undefined, {
        headers: { "X-Timezone": tz },
      });
      return res.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
