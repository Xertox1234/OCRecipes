import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";

import { ApiError } from "@/lib/api-error";
import { compressImage, cleanupImage } from "@/lib/image-compression";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import type { Cookbook } from "@shared/schema";

/**
 * Cover art renders at book proportion (3:4), so the compression target is
 * portrait. The server caps the upload at 2MB; this keeps a typical library
 * photo well under it.
 */
const COVER_MAX_WIDTH = 1200;
const COVER_MAX_HEIGHT = 1600;
const COVER_TARGET_KB = 900;

/**
 * Upload a cover image for a cookbook. Returns the updated cookbook.
 *
 * Mirrors `uploadPhotoForAnalysis`'s error shape: a non-200 becomes an
 * `ApiError` carrying the server's machine-readable `code` (so callers can
 * branch on `RATE_LIMITED`) without leaking the raw response body into UI copy.
 */
export async function uploadCookbookCover(
  cookbookId: number,
  uri: string,
): Promise<Cookbook> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const compressed = await compressImage(uri, {
    maxWidth: COVER_MAX_WIDTH,
    maxHeight: COVER_MAX_HEIGHT,
    quality: 0.85,
    targetSizeKB: COVER_TARGET_KB,
  });

  try {
    const result = await uploadAsync(
      `${getApiUrl()}/api/cookbooks/${cookbookId}/cover`,
      compressed.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "cover",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (result.status !== 200) {
      let code: string | undefined;
      try {
        const parsed: unknown = JSON.parse(result.body);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          typeof (parsed as { code?: unknown }).code === "string"
        ) {
          code = (parsed as { code: string }).code;
        }
      } catch {
        // Non-JSON error body — no machine-readable code to extract.
      }
      throw new ApiError(`Upload failed: ${result.status}`, code);
    }

    try {
      return JSON.parse(result.body) as Cookbook;
    } catch {
      throw new Error("Invalid response from server");
    }
  } finally {
    await cleanupImage(compressed.uri);
  }
}
