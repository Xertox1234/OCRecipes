import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { createUploadFilePart } from "@/lib/upload-file-part";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import { ApiError } from "@/lib/api-error";
import { raiseIfAiSharingRequired } from "@/lib/ai-sharing-events";
import { logger } from "@/lib/logger";
import {
  receiptAnalysisResultSchema,
  receiptConfirmResultSchema,
  type ReceiptAnalysisResult,
  type ReceiptConfirmResult,
  type ReceiptItem,
} from "@shared/schemas/receipt";

export type { ReceiptAnalysisResult, ReceiptConfirmResult, ReceiptItem };

type ScanStage = "compress" | "upload" | "response";

export interface ReceiptScanCount {
  count: number;
  limit: number;
  remaining: number;
}

/**
 * No opt-out (deliberate): ReceiptReviewScreen's visibility for a scan
 * failure is conditional at runtime, not a second call site — when local-OCR
 * fallback items already populated the screen, a scan failure shows nothing
 * at all today; only the no-fallback branch shows the full-screen error.
 * Leaving `meta` unset accepts a redundant toast on the no-fallback branch
 * in exchange for finally covering the has-fallback branch's silent gap.
 */
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

      // A failure only shows "Could not read the receipt", and a pre-upload one
      // leaves no trace on the server. Track the step and how long each took so
      // the dev log (Metro, which the E2E artifacts keep) names it.
      let stage: ScanStage = "compress";
      const durations: Record<ScanStage, number> = {
        compress: 0,
        upload: 0,
        response: 0,
      };
      let stageStart = Date.now();
      const enterStage = (next: ScanStage) => {
        durations[stage] = Date.now() - stageStart;
        stage = next;
        stageStart = Date.now();
      };

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
          formData.append("photos", createUploadFilePart(compressed.uri));
        }

        enterStage("upload");
        const token = await tokenStorage.get();
        const response = await fetch(`${getApiUrl()}/api/receipt/scan`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
          signal: controller.signal,
        });

        enterStage("response");
        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
          };
          raiseIfAiSharingRequired(errorData.code);
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
        durations.response = Date.now() - stageStart;
        logger.info(
          `Receipt scan took compress ${durations.compress} ms, upload ${durations.upload} ms, response ${durations.response} ms`,
        );
        return parsed.data;
      } catch (error) {
        // An unmount abort is not a failure.
        if (!controller.signal.aborted) {
          logger.warn(
            `Receipt scan failed at ${stage} after ${Date.now() - stageStart} ms`,
            error,
          );
        }
        throw error;
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
