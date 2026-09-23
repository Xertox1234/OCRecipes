/**
 * Multer upload configurations for image and audio uploads.
 */
import multer from "multer";

/**
 * Field-name limits shared by every multer instance. GHSA-535w-7cp7-47q4: a
 * field like `items[4294967294]` makes append-field allocate and then iterate
 * a max-length sparse array, blocking the event loop; multer only guards it
 * when `fieldArrayIndexLimit` is set. Clients send plain field names only
 * (photo, photos, audio, avatar, intent, barcode), so no array index is needed.
 */
const FIELD_NAME_LIMITS = { fieldArrayIndexLimit: 0 } as const;

/** Factory for image upload multer configs with consistent fileFilter. */
export function createImageUpload(maxSizeBytes: number) {
  return multer({
    limits: { fileSize: maxSizeBytes, ...FIELD_NAME_LIMITS },
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
  limits: { fileSize: 10 * 1024 * 1024, ...FIELD_NAME_LIMITS }, // 10MB max
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
