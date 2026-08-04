---
title: "ProductHero's hero-image accessibilityLabel placement contradicts CapturedPhotos' group-wrapper pattern"
status: backlog
priority: low
created: 2026-08-04
updated: 2026-08-04
assignee:
labels: [deferred, accessibility]
github_issue:
blocked_reason: "placement decision (group-wrapper vs. alternative) is a human call, not an executor's to invent; confirming it needs a physical-device VoiceOver pass that jsdom cannot substitute for"
human_led: true
---

# ProductHero image label placement vs CapturedPhotos group wrapper

## Summary

`client/components/nutrition/ProductHero.tsx` puts `accessibilityLabel` directly on the
hero product image (via `FallbackImage` → RN `<Image>`). `client/components/nutrition/CapturedPhotos.tsx`
— created in the same slice-2b refactor — solves the identical problem (label an
image+caption pairing) with a group-wrapper (`<View accessible accessibilityLabel=...>`)
instead, and documents why. The two sibling components now embody contradictory
approaches to the same accessibility question.

## Background

React Native gates image accessibility on `accessible={props.alt !== undefined ? true :
props.accessible}` — identically in `Image.ios.js` and `Image.android.js`. A bare
`accessibilityLabel` on an `<Image>` (with no `alt` and no `accessible` prop) does not
make it an accessibility element on either platform, so it may never be announced by
VoiceOver/TalkBack, or — if a platform heuristic surfaces it anyway — could
double-announce against nearby visible text.

`CapturedPhotos.tsx:55-76` carries a long comment explaining exactly this reasoning and
adopts a group-wrapper (`accessible` + `accessibilityLabel` on the parent `View`)
instead, which was device-confirmed correct on iOS VoiceOver in PR #745.

`ProductHero.tsx`'s hero-image labelling is **pre-existing** — it was moved verbatim out
of `NutritionDetailScreen.tsx` by slice 2b, which is a pure refactor with a zero-visual/
zero-behavioural-delta contract. Changing the placement was out of scope for 2b (it would
be a semantic delta forbidden by the slice's own constraints), so the contradiction could
not be fixed there — only recorded.

The characterisation test asserting `queryByLabelText("Image of Cherry Coke")` in
`client/screens/__tests__/NutritionDetailScreen.test.tsx` (describe block
`"NutritionDetailScreen — product hero (2b characterisation)"`) has a comment recording
this: the harness (jsdom) cannot observe RN's `accessible` prop in either direction, so
that test proves only that the label string reached a DOM attribute — nothing about
whether a real screen reader announces it.

## Acceptance Criteria

- [ ] Decide whether the hero image should adopt the same group-wrapper pattern as
      `CapturedPhotos.tsx`, or whether a different resolution is correct for a single
      full-width hero image (as opposed to a two-up photo tile).
- [ ] If a wrapper is adopted, move the `accessibilityLabel`/`accessibilityRole` (if any)
      from the `FallbackImage` to a wrapping `View` with `accessible`, following the
      `CapturedPhotos.tsx` shape.
- [ ] Verify the choice on a physical device with VoiceOver (jsdom cannot verify this —
      see Background). Record the device pass in the PR.
- [ ] Update the `NutritionDetailScreen.test.tsx` "labels the image by product name..."
      test to match wherever the label ends up (wrapper vs. image) — the existing
      characterisation-test comment already documents that a red there means "move the
      assertion," not "the fix is wrong."
- [ ] Confirm `FallbackImage`'s placeholder-branch labelling (the "No product image
      available" case) gets the same treatment for consistency.

## Implementation Notes

- Files: `client/components/nutrition/ProductHero.tsx` (the component to change),
  `client/components/nutrition/CapturedPhotos.tsx` (the reference pattern to follow —
  see its comment at lines 55-76 for the full accessibility rationale), and
  `client/screens/__tests__/NutritionDetailScreen.test.tsx` (the test to update).
- `FallbackImage` (`client/components/FallbackImage.tsx`) is shared by both components —
  check whether the fix belongs at the `FallbackImage` call site (per-consumer wrapper,
  what this todo assumes) or inside `FallbackImage` itself (a built-in wrapper option),
  since the latter would fix every consumer at once but is a larger surface to verify.
- This needs a device pass to confirm either the current behavior or a fix — jsdom
  cannot observe `accessible` in either direction (see
  docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md).

## Scope Contract

- **Mechanisms to use:** the existing `accessible` group-wrapper pattern from
  `CapturedPhotos.tsx` — nothing new.
- **Files in scope:** `client/components/nutrition/ProductHero.tsx`,
  `client/components/nutrition/CapturedPhotos.tsx` (reference only, not modified unless
  the fix moves into `FallbackImage`), `client/components/FallbackImage.tsx` (only if the
  fix belongs there instead), `client/screens/__tests__/NutritionDetailScreen.test.tsx`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Surfaced during the slice-2b final review; `CapturedPhotos.tsx` (the reference
  pattern) is already merged.

## Risks

- Moving the label could change real VoiceOver/TalkBack behavior for the hero image in
  ways that are hard to catch without a device pass — do not merge on jsdom coverage
  alone.

## Updates

### 2026-08-04

- Initial creation, deferred out of the slice-2b final whole-branch review (FIX 6).
