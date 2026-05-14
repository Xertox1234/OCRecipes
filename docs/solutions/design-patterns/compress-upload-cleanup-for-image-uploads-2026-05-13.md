---
title: "Compress-upload-cleanup for image uploads (try/finally)"
track: knowledge
category: design-patterns
tags: [api, upload, image, compression, cleanup, react-native]
module: client
applies_to: ["client/lib/**/*.ts", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Compress-upload-cleanup for image uploads (try/finally)

## When this applies

Any image upload from the client (photo analysis, profile avatars). Always compress before upload and clean up the temporary file afterward using `try/finally`.

## Why

Reduces upload payload (1024px max, JPEG quality 0.7, <1MB target), prevents temp file buildup on device, and `finally` guarantees cleanup even if the upload fails.

## Examples

```typescript
// client/lib/photo-upload.ts
import { compressImage, cleanupImage } from "./image-compression";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";

export async function uploadPhotoForAnalysis(
  uri: string,
  intent: PhotoIntent = "log",
): Promise<PhotoAnalysisResponse> {
  const compressed = await compressImage(uri);

  try {
    const uploadResult = await uploadAsync(
      `${getApiUrl()}/api/photos/analyze`,
      compressed.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        parameters: { intent },
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return JSON.parse(uploadResult.body) as PhotoAnalysisResponse;
  } finally {
    await cleanupImage(compressed.uri); // Always runs, even on error
  }
}
```

Adaptive quality reduction in `client/lib/image-compression.ts`:

```typescript
if (sizeKB > targetSizeKB && quality > 0.3) {
  const newQuality = Math.max(0.3, quality * (targetSizeKB / sizeKB));
  result = await manipulateAsync(uri, [{ resize }], { compress: newQuality });
}
```

## Exceptions

Small files like icons or thumbnails that don't need compression.

## Related Files

- `client/lib/photo-upload.ts` — upload helper
- `client/lib/image-compression.ts` — `compressImage`, `cleanupImage`
