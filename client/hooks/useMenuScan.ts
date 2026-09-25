import { useMutation } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";

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
      formData.append("photo", {
        uri: photoUri,
        type: "image/jpeg",
        name: "menu.jpg",
      } as unknown as Blob);

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
