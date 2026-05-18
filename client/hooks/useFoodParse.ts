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
  sourceType?: "voice" | "text" | "chip";
}

export function useParseFoodText() {
  return useMutation({
    mutationFn: async (text: string): Promise<{ items: ParsedFoodItem[] }> => {
      const res = await apiRequest("POST", "/api/food/parse-text", { text });
      return res.json();
    },
  });
}
