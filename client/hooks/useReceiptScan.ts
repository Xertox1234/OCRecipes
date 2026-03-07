import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import type { PantryItem } from "@shared/schema";

export interface ReceiptItem {
  name: string;
  originalName: string;
  quantity: number;
  unit?: string;
  category: string;
  isFood: boolean;
  estimatedShelfLifeDays: number;
  confidence: number;
}

export interface ReceiptAnalysisResult {
  items: ReceiptItem[];
  storeName?: string;
  purchaseDate?: string;
  totalAmount?: string;
  isPartialExtraction: boolean;
  overallConfidence: number;
}

export interface ReceiptConfirmResult {
  added: number;
  items: PantryItem[];
}

export interface ReceiptScanCount {
  count: number;
  limit: number;
  remaining: number;
}

export function useReceiptScan() {
  return useMutation<ReceiptAnalysisResult, Error, string[]>({
    mutationFn: async (photoUris: string[]) => {
      const formData = new FormData();

      // Compress and add each photo
      const compressedUris: string[] = [];
      for (const uri of photoUris) {
        const compressed = await compressImage(uri, {
          maxWidth: 1536,
          maxHeight: 1536,
          quality: 0.85,
          targetSizeKB: 4500,
        });
        compressedUris.push(compressed.uri);
        // React Native FormData accepts object with uri/type/name (differs from web Blob API)
        formData.append("photos", {
          uri: compressed.uri,
          type: "image/jpeg",
          name: `receipt_${compressedUris.length}.jpg`,
        } as unknown as Blob);
      }

      const token = await tokenStorage.get();
      const response = await fetch(`${getApiUrl()}/api/receipt/scan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      // Cleanup compressed images
      for (const uri of compressedUris) {
        cleanupImage(uri);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Receipt scan failed: ${response.status}`,
        );
      }

      return response.json();
    },
  });
}

export function useReceiptConfirm() {
  const queryClient = useQueryClient();

  return useMutation<
    ReceiptConfirmResult,
    Error,
    {
      name: string;
      quantity: number;
      unit?: string;
      category: string;
      estimatedShelfLifeDays: number;
    }[]
  >({
    mutationFn: async (items) => {
      const res = await apiRequest("POST", "/api/receipt/confirm", { items });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Confirm failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pantry/expiring"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipt/scan-count"] });
    },
  });
}

export function useReceiptScanCount(enabled = true) {
  return useQuery<ReceiptScanCount>({
    queryKey: ["/api/receipt/scan-count"],
    enabled,
    staleTime: 60 * 1000, // 60 seconds
  });
}
