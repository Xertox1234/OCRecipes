import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import type { ApiMedicationLog, Glp1Insights } from "@shared/types/medication";
import type { ProteinSuggestionsResponse } from "@shared/types/protein-suggestions";

export type { ApiMedicationLog, Glp1Insights } from "@shared/types/medication";

export function useMedicationLogs() {
  return useQuery<ApiMedicationLog[]>({
    queryKey: ["/api/medication/logs"],
  });
}

export function useMedicationInsights() {
  return useQuery<Glp1Insights>({
    queryKey: ["/api/medication/insights"],
  });
}

export function useLogMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      medicationName: string;
      brandName?: string;
      dosage: string;
      sideEffects?: string[];
      appetiteLevel?: number;
      notes?: string;
    }) => {
      const res = await apiRequest("POST", "/api/medication/log", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication/logs"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/medication/insights"],
      });
    },
  });
}

export function useUpdateMedicationLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: number;
    } & Partial<{
      medicationName: string;
      brandName: string;
      dosage: string;
      sideEffects: string[];
      appetiteLevel: number;
      notes: string;
    }>) => {
      const res = await apiRequest("PUT", `/api/medication/log/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication/logs"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/medication/insights"],
      });
    },
  });
}

export function useDeleteMedicationLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/medication/log/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication/logs"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/medication/insights"],
      });
    },
  });
}

export type {
  ProteinSuggestion,
  ProteinSuggestionsResponse,
} from "@shared/types/protein-suggestions";

export function useHighProteinSuggestions(enabled = true) {
  return useQuery<ProteinSuggestionsResponse>({
    queryKey: ["/api/medication/protein-suggestions"],
    enabled,
  });
}

export function useToggleGlp1Mode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      glp1Mode: boolean;
      glp1Medication?: string;
    }) => {
      const res = await apiRequest("PUT", "/api/user/glp1-mode", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
    },
  });
}
