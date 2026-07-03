---
title: Magic-byte validation for all file uploads forwarded to external APIs
track: knowledge
category: conventions
module: server
tags: [security, file-upload, mime-type, magic-bytes, validation]
applies_to: [server/routes/**/*.ts, server/lib/image-mime.ts, server/lib/audio-mime.ts]
created: '2026-05-13'
---

# Magic-byte validation for all file uploads forwarded to external APIs

## Rule

Multer's `fileFilter` checks the MIME type from the `Content-Type` header, which is trivially spoofable. For security-sensitive uploads (images sent to AI vision APIs, audio sent to transcription APIs), validate the file's actual content by reading its magic bytes.

Two helpers exist:

- `server/lib/image-mime.ts` — `detectImageMimeType(buffer)` for JPEG, PNG, WebP, GIF, BMP, TIFF
- `server/lib/audio-mime.ts` — `detectAudioMimeType(buffer)` for WAV, MP3, FLAC, OGG, MP4/M4A, WebM

## Examples

```typescript
// ❌ BAD: Trust the Content-Type header
if (!["audio/wav", "audio/mpeg"].includes(file.mimetype)) {
  return res.status(400).json({ error: "Invalid audio type" });
}
// Attacker sends a shell script with Content-Type: audio/wav

// ✅ GOOD: Validate magic bytes from actual file content
import { detectAudioMimeType } from "../lib/audio-mime";

const detectedMime = detectAudioMimeType(req.file.buffer);
if (!detectedMime) {
  return res.status(400).json({ error: "Unrecognized audio format" });
}
// Only recognized audio formats reach the transcription API
```

## When to use

Any route that accepts file uploads and forwards them to an external API (OpenAI Whisper, OpenAI Vision, Runware, etc.). The magic-byte check is the last line of defense before the file leaves your server.

## When NOT to use

Text-only uploads (JSON, CSV) where MIME type is irrelevant.

## Why

`Content-Type` is set by the client; the magic-byte signature is in the file's actual bytes. A non-image-shaped file forwarded to OpenAI Vision can fail in unpredictable ways or, worse, be misinterpreted by the downstream service. Validating magic bytes blocks the spoofed-MIME class of attack outright.

## Related Files

- `server/lib/audio-mime.ts` — `detectAudioMimeType()`, `AUDIO_SIGNATURES`
- `server/lib/image-mime.ts` — `detectImageMimeType()`, `IMAGE_SIGNATURES`
- `server/routes/food.ts` — voice transcription upload with audio magic-byte check
- Audit ref: 2026-04-02-full L4

## See Also

- [Multer error handler pattern](../design-patterns/multer-error-handler-pattern-2026-05-13.md)
