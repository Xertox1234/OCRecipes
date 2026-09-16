import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import { ApiError } from "@/lib/api-error";
import {
  receiptAnalysisResultSchema,
  receiptConfirmResultSchema,
  type ReceiptAnalysisResult,
  type ReceiptConfirmResult,
  type ReceiptItem,
} from "@shared/schemas/receipt";

export type { ReceiptAnalysisResult, ReceiptConfirmResult, ReceiptItem };

export interface ReceiptScanCount {
  count: number;
  limit: number;
  remaining: number;
}

export function useReceiptScan() {
  const abortRef = useRef<AbortController | null>(null);

  // Abort an in-flight scan if the consumer unmounts — the multi-MB upload and
  // the server-side OpenAI vision call otherwise run to completion unread.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return useMutation<ReceiptAnalysisResult, Error, string[]>({
    mutationFn: async (photoUris: string[]) => {
      // A new scan supersedes any previous in-flight one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const formData = new FormData();

      // Compress and add each photo
      const compressedUris: string[] = [];
      try {
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
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errorData.error || `Receipt scan failed: ${response.status}`,
          );
        }

        const json = await response.json();
        const parsed = receiptAnalysisResultSchema.safeParse(json);
        if (!parsed.success) {
          throw new ApiError(
            `Unexpected /api/receipt/scan response shape: ${JSON.stringify(
              parsed.error.flatten(),
            )}`,
            "INVALID_RESPONSE_SHAPE",
          );
        }
        return parsed.data;
      } finally {
        // Runs on success AND on AbortError (unmount-mid-scan): the abort
        // rejects fetch, which propagates here; the temp compressed files must
        // be cleaned regardless. TanStack Query catches the rejection internally.
        await Promise.all(compressedUris.map((uri) => cleanupImage(uri)));
      }
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
      // `apiRequest` throws (via `throwIfResNotOk`) on any non-2xx, so `res` is
      // always ok here — no manual status check needed.
      const res = await apiRequest("POST", "/api/receipt/confirm", { items });
      const json = await res.json();
      const parsed = receiptConfirmResultSchema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError(
          `Unexpected /api/receipt/confirm response shape: ${JSON.stringify(
            parsed.error.flatten(),
          )}`,
          "INVALID_RESPONSE_SHAPE",
        );
      }
      return parsed.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/pantry"] });
      void queryClient.invalidateQueries({
        queryKey: ["/api/pantry/expiring"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/receipt/scan-count"],
      });
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
