---
title: "expo/fetch rejects React Native's { uri, type, name } FormData part — append an expo-file-system File instead"
track: bug
category: runtime-errors
tags: [client-state, react-native, testing]
module: client
applies_to: ["client/hooks/**/*.ts", "client/lib/**/*.ts", "client/screens/**/*.tsx"]
symptoms: ["A photo upload never reaches the server; the step before it (e.g. creating the cook session) succeeds", "\"Unsupported FormDataPart implementation\" thrown before any request is sent, on iOS and Android", "Hook tests stay green"]
created: 2026-10-29
severity: high
---

# expo/fetch rejects React Native's { uri, type, name } FormData part — append an expo-file-system File instead

## Problem

Since the Expo SDK 57 upgrade (#1549) the global `fetch` on iOS and Android is `expo/fetch`. It serializes only FormData parts that are strings, Blobs, or objects with `bytes()`. The React Native idiom `formData.append("photo", { uri, type, name } as any)` throws `Unsupported FormDataPart implementation` before anything is sent.

Three uploads used that shape and were broken on both platforms from the upgrade until #1592: Cook & Track ingredient photos, receipt scan and menu scan.

## Symptoms

- On the phone the request never shows up in the server's http log. Anything sent before the upload, such as the cook-session create, does.
- The screen showed nothing because `CookSessionCaptureScreen` swallowed the error.
- Unit tests passed. jsdom's `FormData` stringifies any value, and `fetch` was mocked, so the bad part was never serialized.

## Root Cause

The `{ uri, type, name }` part only worked because React Native's own `fetch` read those three fields. `expo/fetch` replaced that `fetch` and doesn't treat the object as a file.

## Solution

Build the part with `createUploadFilePart(uri)` (`client/lib/upload-file-part.ts`). It returns an `expo-file-system` `File`, which has `bytes()`, and takes its name and MIME type from the file extension. It throws a clear error when the extension gives no type (#1606), so the part never goes out without a content type that the server's multer filter would reject.

```ts
formData.append("photos", createUploadFilePart(compressed.uri));
```

Uploads that use `uploadAsync` from `expo-file-system/legacy` (photo analysis, label, avatar, cookbook cover) don't go through `fetch` and weren't affected.

## Prevention

- Tests for an upload hook must assert what kind of part was appended (a file object), not just that `fetch` was called. A jsdom `FormData` accepts anything.
- After an SDK upgrade that swaps a global (`fetch`, `FormData`, `crypto`), list every caller of the old idiom and test one of them on a device before closing the upgrade.
- Don't swallow upload errors in a screen. Log them, at least.

## Related Files

- `client/lib/upload-file-part.ts`, `client/lib/__tests__/upload-file-part.test.ts`
- `client/hooks/useCookSession.ts`, `client/hooks/useReceiptScan.ts`, `client/hooks/useMenuScan.ts`
- `client/screens/CookSessionCaptureScreen.tsx`

## See Also

- [expo-file-system root deleteAsync is a throwing stub](../logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md) — another expo-file-system API split between the root and `/legacy`
- [compress → upload → cleanup for image uploads](../design-patterns/compress-upload-cleanup-for-image-uploads-2026-05-13.md) — where the part is built inside the cleanup `try`
