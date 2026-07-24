---
title: "Favourite-heart button unreachable to screen readers inside RecipeBrowserScreen card"
status: done
priority: low
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, client, accessibility]
github_issue:
---

# Favourite-heart button unreachable to screen readers inside RecipeBrowserScreen card

## Summary

The favourite (heart) `Pressable` nested inside `UnifiedRecipeCard` on
`RecipeBrowserScreen` is likely **unreachable to VoiceOver/TalkBack**: the card is
itself a `Pressable` (`accessible={true}` by RN default) with its own
`accessibilityLabel`, which collapses its entire subtree into one focus stop — so
the nested favourite button never becomes its own accessibility node. Screen-reader
users can open the recipe but cannot toggle favourite.

## Background

Surfaced by the `mobile-reviewer` during the final re-review of PR #696 (the
universal allergen-label work), as a **pre-existing, out-of-scope** observation.
PR #696 fixed the _same swallow mechanism_ for the decorative allergen label (by
composing its text into the card's own `accessibilityLabel`), and the reviewer
noted the favourite button next to it has the identical structural problem — but
it is an **interactive** control, not decorative text, so the allergen fix does
NOT transfer: composing a label doesn't make the button _tappable_ via the screen
reader.

This is the canonical "interactive descendant swallowed by an `accessible` parent"
bug documented in
`docs/solutions/logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md`
(the Toast Retry/Undo button sat unreachable for ~4 months the same way).

Severity is **medium** in substance (a real interactive control invisible to
assistive tech) even though it is filed at `P3` priority as a deferred backlog
item.

## Acceptance Criteria

- [x] A VoiceOver/TalkBack user can reach AND activate the favourite toggle on each
      recipe card in `RecipeBrowserScreen`'s `UnifiedRecipeCard`, in addition to
      opening the recipe (both actions reachable). Implemented via
      `accessibilityActions`/`onAccessibilityAction` (screen-reader rotor/actions
      menu) — see caveat on the on-device-verification criterion below.
- [x] The card's primary "open recipe" action remains reachable and correctly
      labelled (including the composed allergen suffix added in PR #696 — do not
      regress it). Confirmed unregressed by diff inspection (the composed-label
      line is untouched) and by both code-reviewer and mobile-reviewer.
- [ ] Fix verified on-device/emulator per
      `docs/solutions/best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md`
      (jsdom cannot assert a11y-tree reachability —
      `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`).
      **NOT COMPLETED** — no adb/Android emulator (or a workable iOS VoiceOver
      verification path) was available in the automated execution environment.
      Code + provable jsdom regression tests + 2-reviewer code review are the
      verification that WAS performed; on-device confirmation is deferred to a
      human/OTA-verify pass.
- [x] Sweep the same card and other recipe-card variants for the identical
      nested-interactive-control-in-accessible-card pattern before closing (per the
      decorative-badge sweep rule in
      `docs/solutions/conventions/parent-label-prefix-decorative-children-2026-05-13.md`).
      Found and fixed the identical bug in `client/components/home/CarouselRecipeCard.tsx`
      (favourite toggle only — its adjacent "Dismiss recipe" button has the same
      swallow bug but was left unfixed as out-of-scope, surfaced separately) and
      `client/screens/FavouriteRecipesScreen.tsx` (remove-from-favourites toggle).
      Ruled out `RecipeActionBar.tsx`, `HistoryItemActions.tsx` (already a sibling,
      not nested), and `CookbookPickerModal.tsx` (not a nested-Pressable-in-card
      shape).

## Implementation Notes

- Location: `client/screens/meal-plan/RecipeBrowserScreen.tsx` — `UnifiedRecipeCard`
  card `Pressable` (~L164–190, its own `accessibilityLabel` composed at ~L190) and
  the nested favourite `Pressable` (`onPress={handleFavourite}`,
  `accessibilityRole="button"`, `accessibilityLabel` ~L251–256).
- The allergen-label fix (composing text into the parent label) is the RIGHT
  pattern for _decorative/informational_ content but is NOT sufficient here — the
  favourite toggle must remain independently **activatable** by the screen reader.
- Candidate approaches (implementer/reviewer to choose; do not over-prescribe):
  1. Expose the favourite toggle as an `accessibilityActions` custom action on the
     card `Pressable` + handle it in `onAccessibilityAction` (keeps the single
     focus stop but adds the action to the rotor). Fold the current/target state
     into the action name/label.
  2. Restructure so the tappable "open recipe" area is a `Pressable` and the
     favourite heart is a **sibling** (not a descendant), so each is its own a11y
     node — verify touch targets stay ≥44pt and layout is unchanged.
- Do NOT simply drop `accessible={true}` off the card without a plan — that can
  re-fragment the card's own label into per-child announcements (the very problem
  the composed label solved).

## Scope Contract

- **Mechanisms to use:** existing RN accessibility primitives (`accessibilityActions`
  / `onAccessibilityAction`, or a sibling-restructure) on the existing card +
  favourite `Pressable`. No new component, no new library.
- **Files in scope:** `client/screens/meal-plan/RecipeBrowserScreen.tsx` and any
  render test for it; other recipe-card variants only if the sweep finds the same
  bug.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. (Builds on the PR #696 allergen-label a11y fix already on `main`, but is
  independent of it.)

## Risks

- Touch-target / layout regression if the favourite heart is restructured as a
  sibling — verify ≥44pt hit target and unchanged visual layout.
- Regressing the card's composed "open recipe" label (which now carries the
  allergen suffix) while fixing the favourite path.

## Updates

### 2026-07-24

- Filed from the PR #696 final re-review. Pre-existing interactive-descendant
  a11y swallow, out of scope for the allergen-label PR; user requested it be
  filed as a P3 backlog item.

### 2026-07-24 (executed)

- Implemented via `accessibilityActions`/`onAccessibilityAction` (candidate
  approach #1) on the card `Pressable`, mirroring the existing
  `client/screens/BatchSummaryScreen.tsx` `BatchItemRow` precedent — the
  card's composed label stays the single VoiceOver/TalkBack focus stop while
  the favourite toggle is exposed as an independently activatable custom
  action.
- Sweep found and fixed the identical bug in two more files:
  `client/components/home/CarouselRecipeCard.tsx` and
  `client/screens/FavouriteRecipesScreen.tsx`. `CarouselRecipeCard.tsx`'s
  adjacent "Dismiss recipe" button has the identical swallow bug but was
  deliberately left unfixed (out of this todo's favourite-only scope) —
  surfaced to the user as a separate finding rather than silently fixed or
  silently filed.
- On-device VoiceOver/TalkBack verification (AC #3) could not be run: no
  adb/Android emulator was available in the execution environment, and the
  booted iOS Simulator has no reliable automated path to confirm custom
  rotor-action reachability. Left unchecked rather than fabricated.
- jsdom cannot model `accessibilityActions`/`onAccessibilityAction` at all
  (confirmed empirically: `accessibilityActions` stringifies to
  `"[object Object]"`; React drops `onAccessibilityAction` as an "Unknown
  event handler property"). Added render tests to the two swept-in files
  (`CarouselRecipeCard.test.tsx`, new `FavouriteRecipesScreen.test.tsx`)
  asserting only what's provable: composed label unchanged + the pre-existing
  visible favourite Pressable's own label/role/`onPress` still work. Did not
  add an equivalent test for `RecipeBrowserScreen.tsx`/`UnifiedRecipeCard`
  itself — exporting it and importing the file pulled in real `react-native`
  via an unidentified deep/transitive import (heavy hook surface: catalog
  search, premium context, etc.), producing a jsdom `SyntaxError`. Reverted
  as disproportionate for this P3; filed as its own follow-up:
  `todos/P3-2026-07-24-unifiedrecipecard-no-render-test-coverage.md`.
- Reviewed by `code-reviewer` and `mobile-reviewer` (2 rounds not needed — no
  CRITICAL findings either round). Both independently flagged the missing
  `RecipeBrowserScreen.tsx` test coverage (see follow-up todo above).
  `mobile-reviewer` separately flagged a pre-existing (not introduced by this
  fix) touch-target gap: the visible favourite/remove icon is ~36×36pt
  effective (20px icon + 8pt hitSlop) vs the 44×44pt WCAG minimum, in both
  `RecipeBrowserScreen.tsx` and `FavouriteRecipesScreen.tsx` — out of scope
  for this todo (screen-reader reachability, not touch-target sizing),
  surfaced to the user rather than fixed or filed.
