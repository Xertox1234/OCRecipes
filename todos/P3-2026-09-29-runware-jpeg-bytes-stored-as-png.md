---
title: "Runware-generated images are JPEG bytes stored as .png / image/png — recipe images, cookbook covers, favicon and splash icon"
status: in-progress
priority: low
created: 2026-09-29
updated: 2026-09-29
assignee:
labels: [deferred, server, image-generation]
github_issue:
---

# Runware-generated images are JPEG bytes stored as .png / image/png

## Summary

`generateImage()` in `server/lib/runware.ts` sends no `outputFormat`, so Runware returns JPEG. Every AI recipe image is then saved through `saveImageBuffer()` → `saveRecipeImage(buffer)`, whose `ext` defaults to `"png"`. The result is a `recipe-<uuid>.png` filename and, on R2, `ContentType: image/png`, both wrapping JPEG bytes. Cookbook covers have the same shape: `server/services/cookbook-cover.ts` saves `generateImage()`'s buffer through `saveCookbookCover(buffer)`, whose `ext` also defaults to `"png"`. The same generator also produced `assets/images/favicon.png` and `assets/images/splash-icon.png` as JPEG bytes.

## Background

This came out of #1166 (app-icon JPEG→PNG). Measured 2026-09-29: the 40 newest `uploads/recipe-images/recipe-*.png` files in dev are all JPEG (`file`). `favicon.png` (1024²) and `splash-icon.png` (512²) are JPEG as well. Clients render the recipe images anyway, because image decoders sniff the bytes. So nothing is visibly broken, but the stored label is wrong on every generated image. See `docs/solutions/conventions/runware-imageinference-defaults-to-jpeg-without-outputformat-2026-09-29.md`: the requested format and the stored label must come from one decision.

## Acceptance Criteria

- [ ] New AI recipe images from the Runware path are stored with a label that matches their bytes. Keep JPEG, since it's smaller for phones, and save with `ext: "jpg"`, which gives a `.jpg` filename and `image/jpeg` ContentType. Don't switch recipe images to PNG. A test proves `saveImageBuffer` passes the matching ext, RED first.
- [ ] Cookbook covers from the Runware path (`server/services/cookbook-cover.ts:308`) get the same treatment: saved with `ext: "jpg"`, test RED first in `server/services/__tests__/cookbook-cover.test.ts`.
- [ ] The DALL-E fallback paths (`server/services/recipe-generation.ts`, `server/services/canonical-enrichment.ts`, `server/services/cookbook-cover.ts:347`) stay correctly labelled. Check what format each fallback actually returns before choosing an ext, and add no guesses.
- [ ] `assets/images/favicon.png` and `assets/images/splash-icon.png` are converted in place to genuine PNGs at the same dimensions (`sips -s format png`), with appearance unchanged. Verify with `file`.
- [ ] `scripts/generate-app-assets.ts` requests `outputFormat: "PNG"` for the assets it writes to `.png` paths. Add it as an option on `generateImage()`, not as a global default.
- [ ] Existing stored images are NOT migrated or rewritten (out of scope). Record that as a note.

## Implementation Notes

- `server/lib/runware.ts`: `generateImage()` builds the `imageInference` body at ~lines 62-74 and has no `outputFormat`. `removeBackground()` sets `outputFormat: "PNG"` at ~line 138. `saveImageBuffer(buffer)` at ~line 181 calls `saveRecipeImage(buffer)`.
- `server/lib/image-store.ts`: `saveRecipeImage(buffer, ext = "png", …)`. `ext` sets both the filename and `CONTENT_TYPE[ext]` for R2. `Ext` already includes `"jpg"` → `image/jpeg`, so no change is needed there.
- Anything that classifies "ours" images by URL shape (`classifyRecipeImageUrl`/`deriveRecipeImageFilename` in `server/lib/recipe-image-keys.ts`, used by `server/scripts/backfill-recipe-images.ts`) must still recognise a `.jpg` key. As of 2026-09-29 it matches on the `/recipe-images/` path prefix, not on `.png`, so no change is expected there. Confirm it with a test. Grep for `recipe-images/` and `.png` assumptions before changing the extension.
- The icon conversions reach devices only via a new native build, not OTA.

## Scope Contract

- **Files in scope:** `server/lib/runware.ts`, `server/services/recipe-generation.ts` + `server/services/canonical-enrichment.ts` (their `saveRecipeImage`/`saveImageBuffer` call sites, ~recipe-generation.ts:316/346) and their existing tests, a new `server/lib/__tests__/runware.test.ts`, `scripts/generate-app-assets.ts`, `server/services/cookbook-cover.ts` + `server/services/__tests__/cookbook-cover.test.ts`, `server/lib/recipe-image-keys.ts` + its test (only if it assumes `.png`), `docs/solutions/conventions/runware-imageinference-defaults-to-jpeg-without-outputformat-2026-09-29.md` (add cookbook covers to its Exceptions paragraph), `assets/images/favicon.png`, `assets/images/splash-icon.png`, plus any other recipe-image URL classifier that assumes `.png` (disclose it under "Out of contract").
- No migration of existing R2 objects.

## Dependencies

- None

## Updates

### 2026-09-29

- Auto-filed (Low) from #1166's executor report; the recipe-image mislabel was confirmed by the orchestrator (40/40 JPEG in dev).
