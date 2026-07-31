---
title: "NutritionDetailScreen ignores both captured photos — local RouteParams shadows the canonical type"
status: done
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

- [x] `NutritionDetailScreen` uses `RootStackParamList["NutritionDetail"]` instead of a
      hand-maintained local `RouteParams` type.
- [x] Both `nutritionImageUri` and `frontImageUri` are read from route params.
- [x] Both captures are displayed when present, alongside (or instead of) the database
      product image — exact layout is a design decision, see below.
- [x] A barcode-only scan (neither param present) renders exactly as it does today — no
      empty frames, no layout shift.
- [x] A partial session (only `nutritionImageUri`) renders sensibly.
- [x] Accessibility: each image has a label distinguishing _which_ capture it is
      ("Nutrition label you photographed" / "Product front you photographed"), not a
      generic "image".
- [x] A test asserts both params reach the screen and both render — using the real
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

### 2026-07-30 (implemented — branch `fix/nutrition-detail-captured-photos`)

All seven acceptance criteria met. Three changed files, no new mechanisms:

- `client/screens/NutritionDetailScreen.tsx` — local `RouteParams` deleted; the route type
  is now `RouteProp<RootStackParamList, "NutritionDetail">`. Both URIs destructured and
  rendered in a "Your photos" group placed under the macro block (the label capture is the
  evidence for those numbers). `resizeMode="contain"` — a portrait panel cropped to a wide
  frame shows a sliver. Neither URI present ⇒ nothing renders, so the barcode-only path is
  unchanged.
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — new `captured photos` suite;
  fixtures built by the real `buildNutritionDetailParams`.
- `test/mocks/react-native.ts` — **prerequisite, and a harness bug in its own right.** The
  hand-written `Image` mock was the only mocked component that did not translate
  `accessibilityLabel`; it fell through into `...rest` and landed on the `<img>` as an
  unrecognised DOM attribute. `getByLabelText` therefore could not find ANY image by its
  label, repo-wide, so image-a11y assertions were silently unwritable. Now mapped to
  `aria-label` + `alt` like `mockComponent` does. Whole client suite re-run: 2572 passed.

**Layout is provisional and deliberately so.** Phase 2 moves this into `ProductHero` /
`NutritionFactsPanel` (spec lines 264-265) and designs the real presentation. What survives
that move is the route typing, the a11y label strings, and the tests; the JSX does not.
Still-open design question, unchanged by this todo: **what step 3's front photo is FOR**
beyond display — the spec's front-label identity analysis (lines 212-222) is Phase 2 work.

Not done, and out of scope per the Scope Contract: tap-to-enlarge, and the two drive-by
notes above (`deriveLogGate` placement, `verificationLevel` runtime validation).

### 2026-07-30 (review round — PR #742)

`/code-review medium` returned 1 Medium + 2 Low. Two fixed in the PR:

- **Medium, tests could not tell a photo from a placeholder.** `FallbackImage` puts the
  same `accessibilityLabel` on its grey fallback `View` as on a loaded `Image`, so
  `getByLabelText(...)` alone passed either way. Repointing `source` at a wrong field
  would have shown the user a grey box with every test still green. Added
  `expectPhotoWithSource`, asserting an actual `<img>` carrying the expected `src`.
  **Validated by sabotage:** forcing `source={{ uri: undefined }}` now fails 2 tests; under
  the old assertions it failed none.
- **Low, a11y label placement.** RN `Image` is not an accessibility element unless
  `accessible` is set, so the label may never reach VoiceOver; where it IS exposed
  (Android) it double-announced against the visible caption below it. Both tiles are now
  one `accessible` group carrying the label, with image + caption collapsed inside — the
  same pattern as the "Heads up" badge group, safe here because the tile has no
  interactive child. Pinned by a new test asserting exactly one labelled node per photo.

**Third finding deliberately NOT fixed here — it is Phase 2 input, not a defect to patch.**
Saving uploads the label photo, so a later scan of the same barcode can show that photo as
the database hero while the freshly-captured one sits in the tile below: near-identical
pictures under two different a11y labels. There is no sound in-place fix — the hero is a
CDN URL and the capture is a `file://` URI, so they cannot be compared. This is precisely
what the spec's `ProductHero` ("Product image (front photo when available)", line 264) is
meant to resolve. Note also that #737 largely mooted the acute case: `handleAddToLog` now
`popTo`s Home in `onSuccess`, so the screen unmounts instead of sitting there re-rendering
with the uploaded image.
