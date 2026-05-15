---
title: "Code quality cleanup from 2026-04-26 audit"
status: in-progress
priority: low
created: 2026-04-26
updated: 2026-04-26
labels: [code-quality, typescript, testing, audit-2026-04-26]
audit_ids: [L13, L14, L17, L20, L21, L23, L24, L25]
---

# Code quality cleanup from 2026-04-26 audit

## Summary

Eight code-quality cleanup items from the 2026-04-26 audit. L22 (Prettier formatting errors) was fixed in the 2026-04-26 fix pass. L14 and L23 may be fully or partially resolved by the M10 fix (runware client deduplication). Items here are low-severity and can be batched in a single cleanup PR.

## Findings (cross-ref `docs/audits/2026-04-26-full.md`)

- **L13** — `RecipeGenerationModal` form state (`servings`, `selectedDiets`, `timeConstraint`, `shareToPublic`) is initialized with `useState` but never reset when `onComplete` fires. If the parent re-opens the modal, the second generation silently inherits the first's preferences. Add a reset call in `onComplete` or move initial values to a factory function called on open. `client/components/RecipeGenerationModal.tsx:54–59`
- **L14** — `generate-app-assets.ts` decodes `b64_json` from the Runware API with `Buffer.from(b64, "base64")` and writes to disk without checking PNG magic bytes or minimum file size. A corrupted API response silently overwrites `assets/images/icon.png`. Add a minimum size check or magic byte validation before `fs.writeFileSync`. `scripts/generate-app-assets.ts:83–93` _(May be partially addressed by M10 fix if script is refactored to use `server/lib/runware.ts`.)_
- **L17** — Two `console.error` calls in `RecipeGenerationModal` (`onError` at line 100, share failure at line 92). Bare `console.error` bypasses any future client-side error reporting pipeline and exposes error object internals in device/crash-reporting logs. _(Share failure at line 92 may be removed by M1 fix. The `onError` at line 100 remains.)_ `client/components/RecipeGenerationModal.tsx:92, 100`
- **L20** — `RecipeGenerationModal` uses `fontWeight: "600"` and `fontWeight: "500"` as magic strings at 9 sites. Project convention is `FontFamily.semiBold` / `FontFamily.medium` from `@/constants/theme`. Inconsistent with every other component. Causes Android font rendering inconsistencies with Poppins. `client/components/RecipeGenerationModal.tsx:214,262,317,365,399,476,490,535,569`
- **L21** — `micronutrient-section-utils.test.ts` imports `classifyMicronutrients` and `getDVColor` directly from `../MicronutrientSection` (the component file) instead of a `micronutrient-section-utils.ts` extraction. Violates the pure-function extraction pattern. Currently works because native imports are mocked but is fragile. `client/components/__tests__/micronutrient-section-utils.test.ts:7`
- **L23** — `generate-app-assets.ts` casts the Runware API response as `{ data: Array<{ imageBase64Data?: string }> }` with no runtime validation. `server/lib/runware.ts` uses Zod `safeParse` as the pattern. _(May be resolved by M10 fix.)_ `scripts/generate-app-assets.ts:83`
- **L24** — `require("react")` inside a `vi.mock` factory in `SearchFilterSheet.test.tsx` is correct (ESM hoisting workaround) but has no explaining comment. Future reviewers will flag it as unintentional. `client/components/meal-plan/__tests__/SearchFilterSheet.test.tsx:8`
- **L25** — `imagePlaceholder` style in `HomeRecipeCard.tsx` `StyleSheet.create` block is never referenced — `FallbackImage` handles placeholder state internally. Dead code. _(May be removed as part of the H1/M12/M13 accessibility fix pass on HomeRecipeCard.)_ `client/components/HomeRecipeCard.tsx:167–174`

## Acceptance Criteria

- [ ] `RecipeGenerationModal` resets form state on `onComplete` (or equivalent re-open trigger)
- [ ] `generate-app-assets.ts` validates decoded buffer size before writing (PNG magic bytes `89 50 4E 47` or minimum size threshold)
- [ ] `console.error` in `RecipeGenerationModal.onError` replaced or removed (the `onSuccess` share-failure path is handled by M1 fix)
- [ ] All `fontWeight: "600"` / `"500"` in `RecipeGenerationModal` replaced with `FontFamily.semiBold` / `FontFamily.medium`
- [ ] `classifyMicronutrients` and `getDVColor` extracted to `client/components/micronutrient-section-utils.ts`; test file updated to import from utils
- [ ] `require("react")` in `SearchFilterSheet.test.tsx` has an inline comment explaining the ESM hoisting constraint
- [ ] `imagePlaceholder` dead style removed from `HomeRecipeCard` (if not already removed by a11y fix pass)
- [ ] All existing tests pass

## Implementation Notes

- L20 (FontFamily): `import { FontFamily } from '@/constants/theme'` — then replace `fontWeight: "600"` with `fontFamily: FontFamily.semiBold` and `fontWeight: "500"` with `fontFamily: FontFamily.medium`. Note: on iOS/Android with custom fonts, use `fontFamily` not `fontWeight` for Poppins variants.
- L21 (test extraction): extract pure functions to a `micronutrient-section-utils.ts` file (no React/RN imports), update the component to import from utils, update the test import path. Pattern is identical to `card-utils.ts`, `confirmation-modal-utils.ts`, etc.
