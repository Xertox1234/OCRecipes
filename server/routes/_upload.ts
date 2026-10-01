/**
 * Multer upload configurations for image and audio uploads.
 */
import multer from "multer";

/**
 * Multipart limits shared by every multer instance — 4 of the 5 the multer
 * README "Security" section recommends, set to the smallest values the real
 * clients need (the 5th, `fileSize`, is set per-instance below since it
 * varies by upload type):
 *
 * - `fieldArrayIndexLimit: 0` — GHSA-535w-7cp7-47q4: a field like
 *   `items[4294967294]` makes append-field allocate and then iterate a
 *   max-length sparse array, blocking the event loop.
 * - `fieldNestingDepth: 0` — every real field name is flat (photo, photos,
 *   audio, avatar, cover, intent, barcode) with no `[` at all, so no bracket
 *   nesting is needed. This also fully subsumes `fieldArrayIndexLimit` above
 *   (multer checks nesting before the array-index check, so any bracketed
 *   name — numeric or not — is now rejected with `LIMIT_FIELD_NESTING`
 *   first); `fieldArrayIndexLimit` is kept as an explicit belt-and-suspenders
 *   record of the original advisory fix.
 * - `fields: 1` — the largest real request sends at most one non-file field
 *   (`intent` on /api/photos/analyze, `barcode` on /api/photos/analyze-label
 *   and /api/verification/front-label — never both in the same request;
 *   every other route sends zero).
 * - `files: 3` — the largest real request is /api/receipt/scan, which
 *   uploads up to 3 files under the `photos` field
 *   (`client/hooks/useReceiptScan.ts`); every other route sends 1.
 */
const MULTIPART_LIMITS = {
  fieldArrayIndexLimit: 0,
  fieldNestingDepth: 0,
  fields: 1,
  files: 3,
} as const;

/** Factory for image upload multer configs with consistent fileFilter. */
export function createImageUpload(maxSizeBytes: number) {
  return multer({
    limits: { fileSize: maxSizeBytes, ...MULTIPART_LIMITS },
    storage: multer.memoryStorage(),
    fileFilter: (_req, file, cb) => {
      const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Invalid file type. Only JPEG, PNG, and WebP allowed."));
      }
    },
  });
}

/** Audio uploads for voice food logging (POST /api/food/transcribe). */
export const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, ...MULTIPART_LIMITS }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "audio/m4a",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
      "audio/x-m4a",
      "audio/aac",
      "audio/ogg",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only audio files are accepted."));
    }
  },
});

// Multer configuration for photo uploads (1MB limit for compressed images)
export const upload = createImageUpload(1 * 1024 * 1024);
