---
title: "Remove the dead dall-e-3 image fallback — Runware is the only image generator"
status: done
priority: medium
created: 2026-10-17
updated: 2026-10-18
assignee:
labels: [deferred, ai, images]
github_issue:
---

# Remove the dead dall-e-3 image fallback

## Summary

OpenAI removed `dall-e-3` from the API on 2026-05-12, so the DALL-E fallback behind Runware has been failing since May. Owner ruling 2026-10-18: **all image generation goes through Runware** — no OpenRouter or Gemini image model replaces it. Delete the dead fallback code so a Runware miss is an honest "no image" instead of a doomed second call.

## Background

Found 2026-10-17 while checking gpt-4o retirement dates against OpenAI's deprecations page ("Past deprecations → 2025-11-14: DALL·E model snapshots": `dall-e-2`/`dall-e-3` shut down 2026-05-12). Runware (`RUNWARE_MODEL_STANDARD` = `runware:400@6`, FLUX.2 klein, about $0.0006/image; `RUNWARE_MODEL_HQ` = `runware:101@1`) is the primary and now the only provider.

An earlier version of this todo proposed Gemini image models as the replacement. The owner corrected that on 2026-10-18: Gemini is the recommendation for the **camera / image-reading** features, not image generation. That work is tracked separately in `todos/P2-2026-10-18-camera-vision-features-to-gemini.md`.

## Acceptance Criteria

- [x] No `dall-e-3` / `dalleClient` left in `server/` (`grep -rn "dalleClient\|dall-e" server` is clean, tests included).
- [x] `dalleClient` is removed from `server/lib/openai.ts`, plus `OPENAI_TIMEOUT_IMAGE_MS` if nothing else uses it.
- [x] Each of the three call sites returns its existing "no image" result when Runware returns nothing or throws, with no second provider call. One test per call site covers that.
- [x] Comments and the "DALL-E negative-prompt suffix" wording in `recipe-generation.ts` are updated. Exclusions stay in Runware's `negativePrompt` field only.
- [x] The image memory (`project_image_generation.md`) states "Runware only, no fallback".

## Implementation Notes

Call sites (all import `dalleClient` from `server/lib/openai.ts`):

- `server/services/recipe-generation.ts` — `generateRecipeImage` (~line 346)
- `server/services/cookbook-cover.ts` — ~line 331
- `server/services/canonical-enrichment.ts` — ~line 157

Check what each caller does with a null image today (placeholder, retry on the next backfill, etc.) and keep it. The backfill script `server/scripts/backfill-recipe-images.ts` already re-runs images that are missing.

## Scope Contract

- **Mechanisms to use:** the existing Runware client (`server/lib/runware.ts`) and each service's existing null-image path. Nothing new.
- **Files in scope:** the three services above, `server/lib/openai.ts`, and their co-located `__tests__/`. Also (added 2026-10-18 after PR #1501 review): `server/routes/__tests__/chat.test.ts`, `server/routes/__tests__/chat-rate-limits.test.ts`, `server/routes/__tests__/photos.test.ts` (vi.mock factories with `dalleClient: {}`) and `server/lib/__tests__/openai.test.ts` (asserted `mod.dalleClient`). Disclosed out-of-contract: `client/hooks/__tests__/notebook-timezone.integration.test.ts` (same `dalleClient: {}` mock) and `server/lib/env.ts` (boot warning said Runware absence "falls back to DALL-E").
- No new providers, modules, or retry layers.

## Risks

- A Runware outage now means recipes have no image until a backfill runs. That is already what happens in practice, since the fallback has been dead since May.

## Updates

### 2026-10-17

- Initial creation (as the Gemini image-revisit todo). Supersedes the same-day `P2-2026-10-17-dall-e-3-image-fallback-retired.md`.

### 2026-10-18

- Owner correction: image generation is Runware only, and Gemini belongs to the camera/vision features. Rescoped to removing the dead fallback, and the vision work moved to its own todo.

### 2026-10-18 (executed)

- Removed `dalleClient` from `server/lib/openai.ts` and the DALL-E branch from `generateRecipeImage`, `generateCookbookCover` and `canonical-enrichment` `generateSingleImage`; each returns its existing null/no-image result when Runware is unconfigured, returns nothing or throws. Tests rewritten per call site; the four extra test files from the PR #1501 review (plus the client notebook-timezone mock) dropped their `dalleClient` mocks. `OPENAI_TIMEOUT_IMAGE_MS` is kept: `recipe-chat.ts` and `canonical-enrichment.ts` still use it for text/vision calls (comment updated). `project_image_generation.md` memory now says "Runware only, no fallback".
