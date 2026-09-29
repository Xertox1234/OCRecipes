---
title: "Runware imageInference defaults to JPEG unless outputFormat is set explicitly"
track: knowledge
category: conventions
tags: [api, harness, typescript, runware, image-generation, assets]
module: server
applies_to: ["server/lib/runware.ts", "scripts/generate-*.ts"]
created: 2026-09-29
---

# Runware imageInference defaults to JPEG unless outputFormat is set explicitly

## Rule

Any call into Runware's `imageInference` task that writes its result to a `.png` path must set
`outputFormat: "PNG"` on the request body. The API defaults to JPEG when the field is omitted —
it does not infer the format from the destination filename or the caller's extension.

## Why

`generateImage()` (`server/lib/runware.ts`) never sets `outputFormat` on its `imageInference`
request, so every image it returns is JPEG-encoded regardless of what the caller does with the
bytes. `scripts/generate-app-assets.ts` writes that buffer straight to `assets/images/icon.png`
and (via a byte-for-byte copy) `assets/images/android-icon-foreground.png`, producing files that
are genuinely JPEG data under a `.png` name — `expo-doctor`'s config-schema check fails on the
extension/content mismatch, and any consumer that reads magic bytes (not just the extension) will
choke on them. The same defect independently affects `assets/images/favicon.png` and
`assets/images/splash-icon.png` (same script, same code path).

Contrast with `removeBackground()` in the same file, which calls the `imageBackgroundRemoval`
task and explicitly sets `outputFormat: "PNG"` (`server/lib/runware.ts:138`) — its own doc comment
promises "a transparent-background PNG." That call site proves the API respects the field when
given it; `generateImage()` simply never passes it.

A `.png`-magic-byte guard added later to `scripts/generate-app-assets.ts` (`PNG_MAGIC`,
`MIN_PNG_SIZE_BYTES`) does not fix this: it validates the buffer Runware returns, and a JPEG
buffer with no PNG magic bytes should fail that guard today — it only failed to catch the original
icon assets because they were generated and committed before the guard existed.

## Examples

```ts
// server/lib/runware.ts — imageInference request body, add outputFormat when the
// output must be PNG (e.g. any caller writing to a `.png` path):
body: JSON.stringify([
  {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: options.model ?? RUNWARE_MODEL_STANDARD,
    positivePrompt: options.prompt,
    negativePrompt: options.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
    width: options.width ?? 1024,
    height: options.height ?? 1024,
    outputFormat: "PNG", // <- required; the API defaults to JPEG without it
    outputType: "base64Data",
    numberResults: 1,
  },
]),
```

## Exceptions

None known — every current writer of a `.png` asset in this codebase wants a real PNG. If a
future caller genuinely wants JPEG bytes, it should name the destination file `.jpg`/`.jpeg`
rather than relying on the API's silent default.

## Related Files

- `server/lib/runware.ts` — `generateImage()` (no `outputFormat`, ~lines 62-74) vs.
  `removeBackground()` (sets it, line 138)
- `scripts/generate-app-assets.ts` — writes `generateImage()`'s buffer to `assets/images/icon.png`
  and copies it to `assets/images/android-icon-foreground.png`

## See Also

- [magic-byte-validation-file-uploads-2026-05-13.md](magic-byte-validation-file-uploads-2026-05-13.md) — related but distinct: validates user-uploaded files, not generated-asset output
