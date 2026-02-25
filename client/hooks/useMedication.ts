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
