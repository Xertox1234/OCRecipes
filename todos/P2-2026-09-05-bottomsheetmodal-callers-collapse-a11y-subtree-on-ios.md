---
title: "8 BottomSheetModal callers collapse their content into one iOS a11y leaf — VoiceOver can't reach sheet contents"
status: backlog
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

- [ ] `accessible={false}` on the `<BottomSheetModal>` at each site below.
- [ ] Each fixed sheet's content (its labelled/testID'd children) is reachable
      as individual descendants — verified per site with Maestro
      `inspect_screen` on a booted sim (the dev loop supports this; jsdom render
      tests CANNOT see the native leaf-collapse, so they are not sufficient
      evidence).
- [ ] No `accessible={false}` regresses a sheet that intentionally relies on the
      wrapper being one adjustable element (none known — the role has no backing
      gesture handler, per the #924 finding — but confirm per site).

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
