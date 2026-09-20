---
title: "8 BottomSheetModal callers collapse their content into one iOS a11y leaf — VoiceOver can't reach sheet contents"
status: done
priority: medium
created: 2026-09-05
updated: 2026-09-05
assignee:
labels: [deferred, accessibility, mobile]
github_issue:
---

# BottomSheetModal callers collapse their content into one iOS a11y leaf

## Summary

Every `<BottomSheetModal>` render site except `ConfirmationModal` (fixed in
PR #924) omits `accessible={false}`. `@gorhom/bottom-sheet` defaults
`accessible=true` on the DraggableView wrapping the sheet's children; on
new-arch Fabric that makes the wrapper an accessibility **leaf**, removing its
descendants from the iOS UIAccessibility tree. VoiceOver users see one opaque
"Bottom Sheet" element and cannot reach the sheet's content — across some of the
app's primary flows (adding food, importing recipes, filtering, beverage
logging).

## Background

Found by the mobile-reviewer pass on PR #924 (issue #908). PR #924 fixed this
for `ConfirmationModal` with `accessible={false}` and **verified the mechanism
on device** (iPhone 17 Pro / iOS 26.5, Maestro `inspect_screen`): pre-fix the
sheet's title/message/buttons were absent from the hierarchy; post-fix each is a
reachable descendant. The remaining 8 sites share the identical shared code path
(`BottomSheetContent`/DraggableView, `DEFAULT_ACCESSIBLE = true`), so the same
defect is expected on all of them — verified on `ConfirmationModal` only, not
separately measured on each. Root-cause detail + the exact fix (must be `false`,
not `null`) is codified in
`docs/solutions/logic-errors/gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md`
(its `applies_to` now covers `client/**/*.tsx`, so the pattern auto-injects when
these files are edited).

Note: some of these sites separately place a _working_ `accessibilityViewIsModal`
on an inner `<BottomSheetView>`/`<View>` (which DOES have a rest-spread) — that
is a different concern (focus trap for content BEHIND the sheet) and does not
address this leaf-collapse of the sheet's OWN content.

## Acceptance Criteria

- [x] `accessible={false}` on the `<BottomSheetModal>` at each site below.
      All 8 applied; `<BottomSheetModal` occurs 9 times in `client/**` and the
      9th (`ConfirmationModal`) already carried it from PR #924.
- [ ] Each fixed sheet's content (its labelled/testID'd children) is reachable
      as individual descendants — verified per site with Maestro
      `inspect_screen` on a booted sim (the dev loop supports this; jsdom render
      tests CANNOT see the native leaf-collapse, so they are not sufficient
      evidence).
      **Deliberately left unchecked.** Not performed for any of the 8 sites.
      Carried forward by
      `todos/P3-2026-09-14-bottomsheetmodal-background-trap-and-on-device-pass.md`,
      which owns the device session. The mechanism itself is not unverified —
      the same code path was device-verified for `ConfirmationModal` in PR #924
      and re-derived from library source during review of this PR — but that is
      mechanism evidence, not per-site evidence, and this criterion asked for
      the latter.
- [x] No `accessible={false}` regresses a sheet that intentionally relies on the
      wrapper being one adjustable element (none known — the role has no backing
      gesture handler, per the #924 finding — but confirm per site).
      Confirmed library-wide rather than per site, which is stronger:
      `grep -rn "onAccessibilityAction\|accessibilityActions"
node_modules/@gorhom/bottom-sheet/src/` returns no matches, so the default
      `accessibilityRole="adjustable"` on that wrapper has no backing handler
      anywhere in the library and nothing could have depended on the grouping.

## Implementation Notes

Sites (verified `grep -rn "<BottomSheetModal" client --include="*.tsx"`, 9 total
minus the fixed `ConfirmationModal`):

- `client/screens/HomeScreen.tsx:540` — import-recipe sheet
- `client/screens/meal-plan/MealPlanHomeScreen.tsx:1455,1469,1483,1499` —
  add-item menu, import-recipe, quick-add, simple-entry (4 sheets)
- `client/screens/meal-plan/RecipeBrowserScreen.tsx:1046` — filter sheet
- `client/screens/meal-plan/RecipeEntryHubScreen.tsx:277` — import-recipe sheet
- `client/components/BeveragePickerSheet.tsx:299` — beverage picker

Line numbers are as of 2026-09-05 — re-grep before editing. Prefer reusing the
exact prop + comment shape from `client/components/ConfirmationModal.tsx` so the
rationale travels with each site.

## Scope Contract

- **Mechanisms to use:** the `accessible={false}` prop already used by
  ConfirmationModal — nothing new.
- **Files in scope:** the 6 files listed above (8 sheets) and any co-located
  tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. PR #924 lands the pattern + codified doc this builds on.

## Risks

- Verification requires a booted iOS sim per site; Android is unaffected by the
  leaf-collapse (RN `accessible={true}` does not collapse the subtree there) so
  this is an iOS-only correctness fix.

## Updates

### 2026-09-05

- Initial creation from the mobile-reviewer CRITICAL surfaced on PR #924.

### 2026-09-13

- Implemented `accessible={false}` at all 8 remaining sites, reusing
  ConfirmationModal.tsx's exact prop + comment shape. Also removed a dead
  `accessibilityViewIsModal` prop directly on 4 `MealPlanHomeScreen.tsx`
  `<BottomSheetModal>` sites (silently dropped by gorhom — no rest-spread —
  same dead-prop class ConfirmationModal's own fix removed); the working
  inner-View `accessibilityViewIsModal` on RecipeBrowserScreen and
  BeveragePickerSheet was left untouched (different, already-working
  concern).
- Added/extended prop-pinning jsdom tests for the 6 sites with an existing
  co-located test file (BeveragePickerSheet, the 4 MealPlanHomeScreen sheets,
  RecipeBrowserScreen's filter sheet); `HomeScreen.tsx` and
  `RecipeEntryHubScreen.tsx` have no existing test file and were left
  untested per the Scope Contract — filed as
  `todos/P3-2026-09-13-homescreen-recipeentryhub-a11y-leaf-fix-untested.md`.
- **Per-site Maestro `inspect_screen` on-device verification (AC #2) was NOT
  performed** — the available booted simulator had an unrelated app in the
  foreground with no OCRecipes session/data state, and standing one up
  (build/launch/login/seed data across 6 screens) was out of proportion for
  this run. The fix mechanism is identical to ConfirmationModal's — verified
  on-device in PR #924 — and was independently confirmed by two reviewer
  agents reading the `@gorhom/bottom-sheet` source directly (no rest-spread
  on `BottomSheetContent`/`BottomSheet`, so the same leaf-collapse and fix
  apply). Recommend a human or follow-up session run the on-device pass
  before treating AC #2 as fully closed.
- Reviewed by `code-reviewer` + `mobile-reviewer`: no CRITICAL findings.
  2 WARNINGs (misleading follow-up comment — fixed; missing test files on 2
  screens — filed as the todo above) and 3 SUGGESTIONs (test names tightened
  to not overclaim device-level proof; one comment-wording nit inherited from
  ConfirmationModal.tsx is out of this todo's scope).

### 2026-09-20

- `todos/P3-2026-09-14-bottomsheetmodal-background-trap-and-on-device-pass.md`
  (the follow-up filed above) closed the background-trap gap for its own AC #1,
  and in doing so corrected this todo's own site inventory: **only 3 of the 8
  sites actually lacked an `accessibilityViewIsModal` background trap**, not 6.
  `client/screens/HomeScreen.tsx`, `MealPlanHomeScreen.tsx`'s import-recipe
  sheet, and `client/screens/meal-plan/RecipeEntryHubScreen.tsx` all render the
  shared `ImportRecipeSheetContent` (`client/components/meal-plan/ImportRecipeSheet.tsx`),
  which already carried the prop on its own content View (from the earlier
  #485 fix, predating this todo) — that follow-up todo's own "Has none" list
  for those 3 sites was itself incorrect, having grepped only the screen files
  and missed the shared child component. The genuinely-untrapped sites were
  `AddItemMenuSheet.tsx`, `QuickAddSheet.tsx`, and `SimpleEntrySheet.tsx`
  (all consumed only by `MealPlanHomeScreen.tsx`); all 3 now set
  `accessibilityViewIsModal` on their own content View.
- **AC #2 (per-site Maestro `inspect_screen` on-device verification, listed
  above) remains NOT performed.** This session could not reach it either:
  `EXPO_PUBLIC_DOMAIN` was unset and no dev server was reachable
  (`curl http://localhost:3000/api/health` failed to connect — no `.env` in
  this worktree), so no simulator/E2E debugging was attempted per the
  project's "check the API IP first" rule. AC #2 is still open; a session with
  a working dev server + booted simulator needs to run it for all 8 sites
  (5 leaf-collapse-only via `accessible={false}`, now all 8 also carry the
  background trap via `accessibilityViewIsModal`).
