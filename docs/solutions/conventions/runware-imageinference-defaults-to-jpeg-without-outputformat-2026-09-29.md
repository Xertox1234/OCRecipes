---
title: "Runware imageInference defaults to JPEG unless outputFormat is set explicitly"
track: knowledge
category: conventions
tags: [api, harness, typescript, runware, image-generation, assets]
module: server
applies_to: ["server/lib/runware.ts", "scripts/generate-*.ts"]
created: 2026-09-29
last_updated: 2026-09-29
---

# Runware imageInference defaults to JPEG unless outputFormat is set explicitly

## Rule

Runware's `imageInference` task returns JPEG unless the request sets `outputFormat`. It does not
infer the format from the destination filename or the caller's extension. So the format of the
bytes and the label they are stored under (file extension, `ContentType`) must come from the same
decision. Either request the format you store (`outputFormat: "PNG"` for a `.png` asset), or
store under the format you actually got (`ext: "jpg"`). Never name the bytes by assumption.

Pick per caller. App-icon assets need real PNGs, so request PNG. Recipe hero images are served to
phones and a 1024² JPEG is several times smaller than the same PNG, so keep JPEG and label it
`jpg`. Don't add `outputFormat: "PNG"` to `generateImage()` for every caller.

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
// A caller that must write a real PNG (app-icon assets) requests it explicitly:
{ taskType: "imageInference", /* … */ outputFormat: "PNG", outputType: "base64Data" }

// A caller that keeps Runware's JPEG default must store it AS JPEG:
await saveRecipeImage(buffer, "jpg"); // not the "png" default
```

## Exceptions

None. The same rule covers the recipe-image path. `saveImageBuffer()` calls
`saveRecipeImage(buffer)`, whose `ext` defaults to `"png"`. Measured 2026-09-29: the 40 newest
`uploads/recipe-images/recipe-*.png` files in dev are all JPEG bytes (`file`), and R2 uploads get
`ContentType: image/png`. Clients still render them because decoders sniff the bytes, but the
label is wrong. The fix there is to label them `jpg`, not to request PNG.

Cookbook covers have the identical shape and the identical fix. `generateCookbookCover()`
(`server/services/cookbook-cover.ts`) calls `runware`'s `generateImage()` with no `outputFormat`,
then saves the JPEG bytes through `saveCookbookCover(buffer)`, whose `ext` also defaults to
`"png"`. Fixed by passing `saveCookbookCover(buffer, "jpg")` on the Runware branch; the DALL-E
fallback branch (`saveCookbookCover(Buffer.from(imageData, "base64"))`, no ext) is unchanged —
DALL-E-3's `images.generate` returns PNG bytes, so the existing `"png"` default already matches
there.

A caller that overwrites an EXISTING stored key in place (`server/scripts/backfill-recipe-images.ts`'s
`refreshInPlace()`) cannot just add `outputFormat: "PNG"` unconditionally — it must preserve
whatever extension the key already has, so the requested format has to be derived from that
extension, not hardcoded. See `resolveRefreshOutputFormat()` in
`server/scripts/backfill-recipe-images-utils.ts`: a `.png` key requests `outputFormat: "PNG"`; a
`.jpg`/`.jpeg` key (or an unrecognized extension) keeps Runware's un-set default (JPEG) rather than
risk mislabeling a post-fix `.jpg` key with PNG bytes — the same defect this rule exists to prevent,
just inverted.

## Related Files

- `server/lib/runware.ts` — `generateImage()` takes an optional `outputFormat?: "PNG"` (per-call,
  not a global default) vs. `removeBackground()` (always sets it, line 138); `saveImageBuffer()`
  takes and forwards an optional `ext`
- `scripts/generate-app-assets.ts` — writes `generateImage()`'s buffer to `assets/images/icon.png`
  and copies it to `assets/images/android-icon-foreground.png`; now requests `outputFormat: "PNG"`
- `server/services/cookbook-cover.ts` — `generateCookbookCover()`'s Runware branch passes
  `saveCookbookCover(buffer, "jpg")`
- `server/scripts/backfill-recipe-images.ts` — `refreshInPlace()` derives the request via
  `resolveRefreshOutputFormat()` (in `server/scripts/backfill-recipe-images-utils.ts`) from the
  preserved key's own extension
- `server/lib/image-store.ts` — `saveRecipeImage(buffer, ext = "png")`; `ext` sets the filename
  and the R2 `ContentType`

## See Also

- [magic-byte-validation-file-uploads-2026-05-13.md](magic-byte-validation-file-uploads-2026-05-13.md) — related but distinct: validates user-uploaded files, not generated-asset output
