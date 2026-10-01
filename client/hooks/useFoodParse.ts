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

/**
 * Every current call site (SimpleEntrySheet directly, and both of
 * useQuickLogSession's internal call sites which feed QuickLogScreen and
 * QuickLogDrawer) already shows a visible error — hardcoded here rather than
 * threaded since none needs the global net. NOTE: a future caller of this
 * hook that doesn't add its own error handling would be silently opted out
 * too — re-check this if a new consumer is added.
 */
export function useParseFoodText() {
  return useMutation({
    mutationFn: async (text: string): Promise<{ items: ParsedFoodItem[] }> => {
      const res = await apiRequest("POST", "/api/food/parse-text", { text });
      return res.json();
    },
    meta: { silentError: true },
  });
}
