---
title: "NutritionDetailScreen ignores both captured photos — local RouteParams shadows the canonical type"
status: backlog
priority: medium
created: 2026-07-30
updated: 2026-07-30
assignee:
labels: [deferred, mobile, scan-flow-2]
github_issue:
---

# NutritionDetailScreen ignores both captured photos

## Summary

A 3-step scan captures a nutrition-label photo and a front-label photo and passes both to
`NutritionDetail`, but the screen displays **neither**. The single image shown is the
product image from the database.

## Background

Found during Phase 1 device verification on 2026-07-30 (PR #736 follow-up). Acceptance
check 4 — "results screen shows both photos" — failed.

The plumbing is complete right up to the last step:

| Layer                                                                                    | State                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `client/navigation/RootStackNavigator.tsx:90-102` — `RootStackParamList.NutritionDetail` | ✅ declares `nutritionImageUri` + `frontImageUri`            |
| `client/screens/scan-screen-utils.ts:375-379` — `buildNutritionDetailParams`             | ✅ sends both                                                |
| `client/screens/NutritionDetailScreen.tsx:50-61` — its own local `RouteParams`           | ❌ omits both                                                |
| `client/screens/NutritionDetailScreen.tsx:181` destructuring                             | ❌ `{ barcode, imageUri, itemId, ocrText }`                  |
| `client/screens/NutritionDetailScreen.tsx:316` render                                    | ❌ one `<FallbackImage source={{uri: nutrition?.imageUrl}}>` |

**Root cause:** the screen declares its own `RouteParams` type instead of using
`RootStackParamList["NutritionDetail"]`. The local type **shadows** the canonical one, so
TypeScript cannot flag a screen that ignores two params the navigator guarantees. Strict
mode does not help — from the screen's perspective those keys do not exist.

Confirmed independently on device: after tapping "Add to Today" the displayed image
_changed_ to the user's label photo, because the save uploaded it and `invalidateQueries`
refetched. That proves the screen renders a server-sourced URL and never reads route params.

## Acceptance Criteria

- [ ] `NutritionDetailScreen` uses `RootStackParamList["NutritionDetail"]` instead of a
      hand-maintained local `RouteParams` type.
- [ ] Both `nutritionImageUri` and `frontImageUri` are read from route params.
- [ ] Both captures are displayed when present, alongside (or instead of) the database
      product image — exact layout is a design decision, see below.
- [ ] A barcode-only scan (neither param present) renders exactly as it does today — no
      empty frames, no layout shift.
- [ ] A partial session (only `nutritionImageUri`) renders sensibly.
- [ ] Accessibility: each image has a label distinguishing _which_ capture it is
      ("Nutrition label you photographed" / "Product front you photographed"), not a
      generic "image".
- [ ] A test asserts both params reach the screen and both render — using the real
      `buildNutritionDetailParams` output as the fixture, not a hand-written params object
      (a hand-written one is what would have hidden this).

## Implementation Notes

- Pair with the **Phase 2 design pass** — "show both photos" needs a layout decision
  (side-by-side thumbnails? a strip? tap to enlarge?), not just a destructure. See
  `docs/superpowers/specs/2026-07-29-barcode-scan-flow-2.0-design.md`.
- The photos are evidence for the values on screen: the nutrition-label capture is what the
  numbers were read from, so placing it near the macro block is more useful than a hero
  image.
- While in here: `nutrition-detail-utils.ts`'s `deriveLogGate` arguably belongs outside
  `client/screens/`, and `verificationLevel` has no runtime validation. Both noted during
  PR #736; neither is required by this todo.

## Scope Contract

- **Mechanisms to use:** the existing `RootStackParamList` type and the existing
  `FallbackImage` component — no new image library, no new route params.
- **Files in scope:** `client/screens/NutritionDetailScreen.tsx`, its `__tests__/`, and
  optionally `client/screens/nutrition-detail-utils.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Phase 2 design pass (layout decision) — soft dependency; the type fix can land first.

## Risks

- Replacing the local type may surface other params the screen silently ignores. That is the
  point, but it can widen the diff — check what else `RootStackParamList` declares.

## Updates

### 2026-07-30

- Initial creation, deferred out of the Phase 1 device-verification session.
