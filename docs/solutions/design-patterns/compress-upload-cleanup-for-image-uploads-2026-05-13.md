---
title: Compress-upload-cleanup for image uploads (try/finally)
track: knowledge
category: design-patterns
module: client
tags: [api, upload, image, compression, cleanup, abort, react-native]
applies_to: [client/lib/**/*.ts, client/hooks/**/*.ts, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Compress-upload-cleanup for image uploads (try/finally)

## When this applies

Any image upload from the client (photo analysis, profile avatars, receipt scans, cook-session photos). Always compress before upload and clean up every temporary file afterward using `try/finally`.

## Why

Reduces upload payload (1024px max, JPEG quality 0.7, <1MB target), prevents temp file buildup on device, and `finally` guarantees cleanup even if the upload fails.

When a native upload helper does not accept `AbortSignal` (for example Expo `uploadAsync`), cancellation is cooperative: check the signal before starting expensive work, after compression, after the upload returns, and before parsing or mutating React state. The network request may still finish server-side, so the caller must own its current controller and ignore aborted completions.

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

For multi-photo uploads, collect compressed URIs as they are created and clean the whole owned set in one `finally` block:

```typescript
const compressedUris: string[] = [];

try {
  for (const uri of photoUris) {
    const compressed = await compressImage(uri);
    compressedUris.push(compressed.uri);
    formData.append("photos", toPhotoBlob(compressed.uri));
  }

  return await uploadPhotos(formData);
} finally {
  await Promise.all(compressedUris.map((uri) => cleanupImage(uri)));
}
```

For cooperative cancellation around Expo `uploadAsync`, keep the signal checks near each async boundary:

```typescript
throwIfAborted(signal);
const compressed = await compressImage(uri);
throwIfAborted(signal);
const uploadResult = await uploadAsync(url, compressed.uri, options);
throwIfAborted(signal);
return parseUploadResult(uploadResult.body);
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
- `client/hooks/useReceiptScan.ts` — multi-photo cleanup ownership
- `client/hooks/useCookSession.ts` — single-photo hook cleanup ownership
