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
