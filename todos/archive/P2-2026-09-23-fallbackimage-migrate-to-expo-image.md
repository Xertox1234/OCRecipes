---
title: "FallbackImage (every recipe/history thumbnail) uses plain RN Image and downloads full-resolution images — migrate to expo-image"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, performance]
github_issue:
---

# FallbackImage (every recipe/history thumbnail) uses plain RN Image and downloads full-resolution images — migrate to expo-image

## Summary

The shared thumbnail component renders full-resolution R2/API images through RN `Image` with no caching or downsampling control, on every carousel, history row and recipe-browser row. `expo-image` 3.0.11 is already installed but used in only 2 files.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M5, L11** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/components/FallbackImage.tsx:140-149`; `resolveImageUrl` (`client/lib/query-client.ts:235-242`) returns URLs with no size params.
- L11: `client/camera/components/ProductChip.tsx:272-276` 44×44 thumbnail, same class.
- Research (expo-image 3.0.11 `Image.types.ts`: `cachePolicy`, `allowDownscaling` default true, `contentFit`; RN 0.81 `resizeMethod` is Android-only): `confirmed`.

## Acceptance Criteria

- [x] FallbackImage renders `expo-image` `Image` with `contentFit` matching current behavior and `cachePolicy="memory-disk"`, keeping the onError → fallback semantics
- [x] ProductChip thumbnail uses the same component or expo-image
- [x] FallbackImage tests cover valid-uri, invalid-uri, and load-error fallback paths
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Check the expo-image jest/vitest mock story before starting (test/mocks). Size-variant URLs from R2 are a separate, larger follow-up — out of scope.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/FallbackImage.tsx`
  - `client/components/FallbackImage-utils.ts`
  - `client/camera/components/ProductChip.tsx`
  - `test/mocks (expo-image mock if needed)`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- The `onError` event shape differs between RN Image and expo-image — update the handler type.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M5, L11).

### 2026-09-25

- Implemented: `FallbackImage.tsx` and `ProductChip.tsx` now render `expo-image`'s `Image` with `cachePolicy="memory-disk"`; `contentFit` deliberately left unset (expo-image's default "cover" matches RN Image's old default, and several call sites still pass the still-supported deprecated `resizeMode` compat prop). Added `test/mocks/expo-image.ts` (aliased in `vitest.config.mts`) and `FallbackImage.test.tsx` (valid-uri, invalid-uri, empty-uri, load-error). TDD verified: the cache-policy assertion failed against pre-migration code and passed after.
- Reviewed by `code-reviewer` (No findings) and `mobile-reviewer` (one SUGGESTION, comment-wording only, applied inline; No blocking findings). Full suite green: 546 files / 8691 tests, `check:types` clean, `lint` clean.

### 2026-09-25 (review repair)

- The solution doc had the onError mechanism backwards. An RN-typed handler fails to compile under `strictFunctionTypes` (TS2322, measured with `tsc --strict`), and at runtime `event.nativeEvent.error` still resolves through expo-image's deprecated getter. Corrected. Added a test that FallbackImage never sets `contentFit` (it fails when `contentFit="cover"` is injected), protecting `resizeMode="contain"` callers.
