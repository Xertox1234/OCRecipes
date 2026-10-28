import { useMutation } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { File as ExpoFile } from "expo-file-system";

export interface MenuAnalysisItem {
  name: string;
  description?: string;
  price?: string;
  estimatedCalories: number;
  estimatedProtein: number;
  estimatedCarbs: number;
  estimatedFat: number;
  tags: string[];
  recommendation?: "great" | "good" | "okay" | "avoid";
  recommendationReason?: string;
}

export interface MenuAnalysisResult {
  restaurantName?: string;
  cuisine?: string;
  menuItems: MenuAnalysisItem[];
}

/**
 * No opt-out (deliberate): MenuScanResultScreen's visibility for a scan
 * failure is conditional at runtime, not a second call site — same
 * has-fallback/no-fallback split as `useReceiptScan`. Leaving `meta` unset
 * accepts a redundant error on the no-fallback branch (which already shows
 * a full-screen error) in exchange for finally covering the has-fallback
 * branch's silent gap.
 */
export function useMenuScan() {
  return useMutation<MenuAnalysisResult, Error, string>({
    mutationFn: async (photoUri: string) => {
      const token = await tokenStorage.get();
      const formData = new FormData();
      // A file object with bytes(), not RN's `{ uri, type, name }`: the global
      // fetch is `expo/fetch` since SDK 57, and it rejects that shape.
      formData.append("photo", new ExpoFile(photoUri));

      const response = await fetch(`${getApiUrl()}/api/menu/scan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      return response.json();
    },
  });
}
