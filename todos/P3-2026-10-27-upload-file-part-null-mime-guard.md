---
title: "Uploads: fail loudly when an ExpoFile part has no MIME type (menu scan skips compression)"
status: backlog
priority: low
created: 2026-10-27
updated: 2026-10-27
assignee:
labels: [deferred, client, uploads]
github_issue:
---

# Uploads: fail loudly when an ExpoFile part has no MIME type

## Summary

The three photo uploads now append `new ExpoFile(uri)` (expo/fetch rejects RN `{ uri, type, name }` parts). The part's MIME type comes only from the file extension; an unknown or missing extension gives `type === null`, the part goes out without a content-type, busboy defaults it to `text/plain`, and the server's multer filter rejects it with an unclear error.

## Background

Review WARNING on the expo/fetch upload fix (2026-10-27). Safe today: Cook & Track and receipt photos go through `compressImage` (always JPEG), and menu scan's only producer is the VisionCamera `capturePhotoToFile` `.jpg`. A future gallery or content:// source for menu scan would hit it.

## Acceptance Criteria

- [ ] `useMenuScan` compresses like the other two (gives a `.jpg` and a size cap), OR a small shared helper throws a clear error when `file.type` is null.
- [ ] If a helper is added, the three duplicated "why ExpoFile" comments move into it.
- [ ] Move the duplicated `expo-file-system` test mock (three hook tests) into a shared `test/mocks` entry.

## Implementation Notes

- Files: `client/hooks/useMenuScan.ts`, `client/hooks/useCookSession.ts`, `client/hooks/useReceiptScan.ts`, their tests in `client/hooks/__tests__/`, `client/lib/image-compression.ts` (reuse `compressImage`).
- Server filter: `server/routes/_upload.ts` (checks `file.mimetype`).

## Scope Contract

- **Files in scope:** the files listed above and a `test/mocks/expo-file-system.ts` if extracted.
- No change to the server filter.

## Updates

### 2026-10-27

- Filed from the one review pass on the expo/fetch upload fix.
