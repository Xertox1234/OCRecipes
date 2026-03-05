import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

export interface ParsedFoodItem {
  name: string;
  quantity: number;
  unit: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servingSize: string | null;
}

export function useParseFoodText() {
  return useMutation({
    mutationFn: async (text: string): Promise<{ items: ParsedFoodItem[] }> => {
      const res = await apiRequest("POST", "/api/food/parse-text", { text });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      return res.json();
    },
  });
}
