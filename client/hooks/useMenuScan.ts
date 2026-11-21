import { useMutation } from "@tanstack/react-query";
import { getApiUrl, notifyIfSessionExpired } from "@/lib/query-client";
import { raiseIfAiSharingRefusal } from "@/lib/ai-sharing-events";
import { tokenStorage } from "@/lib/token-storage";
import { createUploadFilePart } from "@/lib/upload-file-part";
import { compressImage, cleanupImage } from "@/lib/image-compression";

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

// Module-level, not inline in the hook: React Compiler bails on a
// try/finally inside a hook's callback (docs/solutions/code-quality/
// react-compiler-bails-on-try-finally-inside-a-hook-callback-2026-10-18.md).
async function scanMenuPhoto(photoUri: string): Promise<MenuAnalysisResult> {
  // Same settings as useReceiptScan: the server caps the upload at 5 MB, and a
  // full-resolution capture or gallery photo can exceed it. Only the
  // compressed copy is ours to delete — the caller owns photoUri.
  const compressed = await compressImage(photoUri, {
    maxWidth: 1536,
    maxHeight: 1536,
    quality: 0.85,
    targetSizeKB: 4500,
  });
  try {
    const token = await tokenStorage.get();
    const formData = new FormData();
    formData.append("photo", createUploadFilePart(compressed.uri));

    const response = await fetch(`${getApiUrl()}/api/menu/scan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    await notifyIfSessionExpired(response, token);

    if (!response.ok) {
      const text = await response.text();
      raiseIfAiSharingRefusal(text);
      throw new Error(`${response.status}: ${text}`);
    }

    return (await response.json()) as MenuAnalysisResult;
  } finally {
    await cleanupImage(compressed.uri);
  }
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
    mutationFn: scanMenuPhoto,
  });
}
