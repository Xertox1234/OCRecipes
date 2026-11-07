---
title: A multer fileFilter rejection is never a MulterError — throw a typed error and match it by class, not by message text
track: knowledge
category: best-practices
module: server
severity: low
tags: [api, architecture, multer, uploads, error-handling, express]
applies_to: [server/routes/_upload.ts, server/routes.ts]
created: '2026-11-06'
---

# A multer fileFilter rejection is never a MulterError

## Rule

A `fileFilter` that rejects a file calls `cb(new InvalidFileTypeError(...))`, never a plain `new Error(...)`. The upload error handler (`handleUploadError` in `server/routes/_upload.ts`) matches it with `instanceof`, never with `err.message.includes(...)`. Every branch responds through `sendError`.

## Why

- The multer v2.5.0 README (via Context7, 2026-11-06) defines `MulterError` codes only for multer's own limits (`LIMIT_FILE_SIZE`, `LIMIT_FIELD_NESTING`, …). A fileFilter error reaches Express exactly as thrown, so `instanceof MulterError` never matches it.
- The old handler fell back to matching message text. That broke silently if the wording changed, and it turned any unrelated error mentioning "Invalid file type" into a 400. That was finding L3 in the 2026-11-06 architecture audit.
- `cb(null, false)` is not a substitute. It skips the file silently with no 400.

## Examples

- A multer limit keeps multer's own code on the wire: `sendError(res, 400, err.message, err.code)`. Clients may branch on `LIMIT_*`, so changing it would be an API change.
- A rejected type returns `{ error, code: "VALIDATION_ERROR" }`.
- Anything else goes to `next(err)`.
- Tests drive real multer through the real handler (`server/routes/__tests__/_upload.test.ts`, `describe("handleUploadError")`).

## Related Files

- `server/routes/_upload.ts`, `server/routes.ts`, `server/routes/__tests__/_upload.test.ts`

## See Also

- `docs/rules/api.md`: every error response goes through `sendError` with an `ErrorCode`
