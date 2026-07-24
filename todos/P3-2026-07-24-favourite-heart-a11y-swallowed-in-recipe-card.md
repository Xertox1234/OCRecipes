---
title: "Favourite-heart button unreachable to screen readers inside RecipeBrowserScreen card"
status: backlog
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

- [ ] A VoiceOver/TalkBack user can reach AND activate the favourite toggle on each
      recipe card in `RecipeBrowserScreen`'s `UnifiedRecipeCard`, in addition to
      opening the recipe (both actions reachable).
- [ ] The card's primary "open recipe" action remains reachable and correctly
      labelled (including the composed allergen suffix added in PR #696 — do not
      regress it).
- [ ] Fix verified on-device/emulator per
      `docs/solutions/best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md`
      (jsdom cannot assert a11y-tree reachability —
      `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`).
- [ ] Sweep the same card and other recipe-card variants for the identical
      nested-interactive-control-in-accessible-card pattern before closing (per the
      decorative-badge sweep rule in
      `docs/solutions/conventions/parent-label-prefix-decorative-children-2026-05-13.md`).

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
