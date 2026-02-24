import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface ExerciseLog {
  id: number;
  userId: string;
  exerciseName: string;
  exerciseType: string;
  durationMinutes: number;
  caloriesBurned: string | null;
  intensity: string | null;
  sets: number | null;
  reps: number | null;
  weightLifted: string | null;
  distanceKm: string | null;
  source: string;
  notes: string | null;
  loggedAt: string;
}

export interface ExerciseLibraryEntry {
  id: number;
  name: string;
  type: string;
  metValue: string;
  isCustom: boolean;
}

export function useExerciseLogs(options?: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);
  const qs = params.toString();
  const url = qs ? `/api/exercises?${qs}` : "/api/exercises";

  return useQuery<ExerciseLog[]>({
    queryKey: [url],
  });
}

export function useExerciseSummary(date?: string) {
  const params = date ? `?date=${date}` : "";
  return useQuery<{
    totalCaloriesBurned: number;
    totalMinutes: number;
    exerciseCount: number;
  }>({
    queryKey: [`/api/exercises/summary${params}`],
  });
}

export function useLogExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      exerciseName: string;
      exerciseType: string;
      durationMinutes: number;
      caloriesBurned?: number;
      intensity?: string;
      sets?: number;
      reps?: number;
      weightLifted?: number;
      distanceKm?: number;
      notes?: string;
    }) => {
      const res = await apiRequest("POST", "/api/exercises", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exercises/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] });
    },
  });
}

export function useDeleteExerciseLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/exercises/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exercises/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] });
    },
  });
}

export function useSearchExerciseLibrary(query: string) {
  return useQuery<ExerciseLibraryEntry[]>({
    queryKey: [`/api/exercise-library?q=${encodeURIComponent(query)}`],
    enabled: query.length >= 1,
  });
}
