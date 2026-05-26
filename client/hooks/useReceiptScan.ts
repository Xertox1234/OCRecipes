import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import { ApiError } from "@/lib/api-error";

/**
 * Runtime schemas for the receipt endpoints, validated at the network boundary
 * so server contract drift surfaces as a structured error instead of a silent
 * bad cast. Shapes mirror the JSON wire format, not the Drizzle/server types
 * (see the per-field notes on `pantryItemSchema` for the decimal/timestamp →
 * string serialization). On the scan response below, `category` is kept as a
 * plain string (the server enum is validated server-side) for forward-compat
 * with new categories.
 */
const receiptItemSchema = z.object({
  name: z.string(),
  originalName: z.string(),
  quantity: z.number(),
  unit: z.string().optional(),
  category: z.string(),
  isFood: z.boolean(),
  estimatedShelfLifeDays: z.number(),
  confidence: z.number(),
});

const receiptAnalysisResultSchema = z.object({
  items: z.array(receiptItemSchema),
  storeName: z.string().optional(),
  purchaseDate: z.string().optional(),
  totalAmount: z.string().optional(),
  isPartialExtraction: z.boolean(),
  overallConfidence: z.number(),
});

// Wire shape of a `PantryItem` (shared/schema). The Drizzle row types the
// timestamps as `Date` and `quantity` as `string`, but JSON serialization sends
// timestamps as ISO strings — this schema matches what actually arrives.
const pantryItemSchema = z.object({
  id: z.number(),
  userId: z.string(),
  name: z.string(),
  quantity: z.string().nullable(),
  unit: z.string().nullable(),
  category: z.string().nullable(),
  expiresAt: z.string().nullable(),
  addedAt: z.string(),
  updatedAt: z.string(),
});

const receiptConfirmResultSchema = z.object({
  added: z.number(),
  items: z.array(pantryItemSchema),
});

export type ReceiptItem = z.infer<typeof receiptItemSchema>;
export type ReceiptAnalysisResult = z.infer<typeof receiptAnalysisResultSchema>;
export type ReceiptConfirmResult = z.infer<typeof receiptConfirmResultSchema>;

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
