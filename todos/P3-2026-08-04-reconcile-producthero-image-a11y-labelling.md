---
title: "FallbackImage never announces its accessibilityLabel — three call sites pass one that no screen reader reads"
status: backlog
priority: low
created: 2026-08-04
updated: 2026-08-04
assignee:
labels: [deferred, accessibility]
github_issue:
blocked_reason: "the fix direction depends on whether these images are decorative (delete the labels) or informative (make them focusable, accepting a double-announce against adjacent text) — an intent call, not an executor's to invent; confirming either needs a device pass jsdom cannot substitute for"
human_led: true
---

# FallbackImage's accessibilityLabel is never announced

## Summary

`client/components/FallbackImage.tsx` documents its `accessibilityLabel` prop as
"Accessibility label for both image and fallback" (`:35-36`). The image branch does not
keep that promise on either platform: it renders `<Image accessibilityLabel={...}>` with
no `alt` and no `accessible`, and React Native gates image accessibility on
`accessible={props.alt !== undefined ? true : props.accessible}` — identically in
`Image.ios.js` and `Image.android.js`. The label reaches the native node as a content
description, but the node is never a focus stop, so it is never read.

**Device-confirmed 2026-08-04**, not inferred from RN source: the Android accessibility
tree for the hero image reads

```
[ImageView] desc='Image of coca-cola' focusable=false bounds=[42,263][1038,656]
```

— a content description on a node TalkBack skips.

Three call sites pass a label that therefore does nothing:

| Call site                                        | Label                                                   | Adjacent visible text                                    |
| ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------- |
| `client/components/nutrition/ProductHero.tsx:46` | `Image of {productName}` / `No product image available` | product name as `<ThemedText type="h2">` two nodes below |
| `client/screens/ItemDetailScreen.tsx:212`        | `Photo of {productName}`                                | the product name                                         |
| `client/components/RecipeDetailContent.tsx:250`  | `Photo of {title}`                                      | the recipe title                                         |

## Background

This was originally filed as a narrower question — `ProductHero` labels its image directly
while its slice-2b sibling `CapturedPhotos` uses an `accessible` group wrapper and
documents why, so the two contradict each other. The Android device pass moved the root
cause: **the defect is inside `FallbackImage`, and it is app-wide, not specific to the
nutrition screen.** `FallbackImage.tsx` has 12 consumers; 3 pass a label.

**Do not "fix the gating" as the first move.** Making the image an accessibility element
(via `alt={accessibilityLabel}`, or passing `accessible` through) turns all three into
focus stops — and all three then announce a name that the adjacent visible text already
carries, which is the double-announce family this repo consistently guards against. The
gating is not the bug; the unresolved **intent** is. Settle intent per call site first,
then decide whether `FallbackImage` needs any change at all.

The strong likelihood is that all three images are **decorative** — they convey nothing the
neighbouring heading does not — and today's `focusable=false` is accidentally the correct
outcome, reached by a mechanism nobody chose. If so the fix is to delete three dead props
and mark the component explicitly decorative, not to make it speak.

**One genuine gap survives that reading:** the fallback branch (`FallbackImage.tsx:85-105`)
renders `<View accessibilityLabel={...} accessibilityRole="image">` with **no `accessible`**
and a distinct string — "No product image available" — that no adjacent text carries. Its
focusability has not been checked in the Android tree (the fixture used for the dump had a
real image). Whether a bare `accessibilityRole` on a `View` yields `focusable=true` is the
one factual question still open, and it is worth answering before deciding anything else.

Note on precedent: `CapturedPhotos.tsx` justified its group wrapper partly by citing
`docs/rules/accessibility.md` as prohibiting the double-announce. That is an over-read —
that file's double-announce rules (decorative icons, emoji, badges) all address elements
**nested inside a labelled parent**, not sibling redundancy. The comment was corrected on
the slice-2b branch. The repo's posture still clearly disfavours redundant announcement;
it just is not a literal rule, so this remains a judgment call rather than a lookup.

## Acceptance Criteria

- [ ] Determine whether a `View` with `accessibilityRole="image"` and no `accessible` prop
      is `focusable=true` in the Android tree — this decides whether the fallback branch's
      "No product image available" is currently announced or silently dropped.
- [ ] Decide intent per call site: decorative (no announcement) or informative (a focus
      stop). Expect the same answer for all three image branches; the fallback branch may
      legitimately differ.
- [ ] Implement the decision once, in `FallbackImage`, rather than three times at the call
      sites. If decorative: remove the now-dead `accessibilityLabel` props and make the
      component explicitly decorative (`accessible={false}` +
      `importantForAccessibility="no"`), so the next consumer cannot re-introduce a label
      that silently does nothing. Consider removing the `accessibilityLabel` prop from the
      public interface entirely — a prop that cannot work is a trap.
- [ ] If a label IS wanted anywhere, use the group-wrapper shape from `CapturedPhotos.tsx`
      at that call site, and check the wrapper's own Android behaviour first — see
      `todos/P2-2026-08-04-heads-up-accessible-group-diverges-ios-android.md`, which shows
      that wrapper does not collapse on Android.
- [ ] Verify on a device with VoiceOver AND TalkBack. jsdom cannot observe `accessible` in
      either direction.
- [ ] Update the `"labels the image by product name..."` test in
      `client/screens/__tests__/NutritionDetailScreen.test.tsx` (describe block
      `"NutritionDetailScreen — product hero (2b characterisation)"`) to match. Its
      comment at `:716` already records that a red there means "move the assertion", not
      "the fix is wrong".

## Implementation Notes

- Primary file: `client/components/FallbackImage.tsx` — image branch `:109-117`, fallback
  branch `:85-105`, prop docs `:35-36`.
- Call sites: `client/components/nutrition/ProductHero.tsx:46`,
  `client/screens/ItemDetailScreen.tsx:212`,
  `client/components/RecipeDetailContent.tsx:250`.
- Reference pattern (group wrapper): `client/components/nutrition/CapturedPhotos.tsx:55-100`.
- **Sequencing.** `FallbackImage.tsx`, `ItemDetailScreen.tsx` and `RecipeDetailContent.tsx`
  are all on `main` and untouched by slice 2b. `ProductHero.tsx` exists **only** on
  `refactor/nutrition-detail-slice-2b` — `client/components/nutrition/` does not exist on
  `main` at all. So a coherent single-PR fix has to wait until **PR #751 merges**; doing
  the main-side half first would split one change across two PRs and could break the
  branch's compile if the prop is removed.
- Android method: `adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml`,
  then read `content-desc` + `focusable` per node. See
  `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`
  for why the unit tests cannot stand in.

## Scope Contract

- **Mechanisms to use:** existing RN a11y props (`accessible`, `alt`,
  `importantForAccessibility`) and the existing group-wrapper pattern — nothing new.
- **Files in scope:** `client/components/FallbackImage.tsx`,
  `client/components/nutrition/ProductHero.tsx`, `client/screens/ItemDetailScreen.tsx`,
  `client/components/RecipeDetailContent.tsx`,
  `client/screens/__tests__/NutritionDetailScreen.test.tsx`, plus any existing
  `FallbackImage` tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- **PR #751 must merge first** — see Sequencing above.

## Risks

- Deleting labels is easy to misread as removing accessibility. It is the opposite here:
  the labels are already inert, and leaving them implies a coverage that does not exist.
  Whichever way it goes, record the device evidence in the PR.
- The reverse risk is larger: "restoring" the labels by making the images focusable
  introduces three new double-announces and would present as a regression to any
  screen-reader user, on a surface that reads fine today.

## Updates

### 2026-08-04 (second pass — root cause moved)

- Android device pass confirmed `focusable=false` on the hero image, upgrading the RN-source
  prediction to an observed fact and relocating the root cause from `ProductHero` to
  `FallbackImage`. Scope widened from 1 file to 4; two of them are outside the nutrition
  screen entirely. Recorded the "do not fix the gating first" trap, the surviving
  fallback-branch question, and the merge-order constraint.

### 2026-08-04

- Initial creation, deferred out of the slice-2b final whole-branch review (FIX 6).
