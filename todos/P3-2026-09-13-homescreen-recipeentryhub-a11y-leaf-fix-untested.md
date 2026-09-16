---
title: "HomeScreen.tsx and RecipeEntryHubScreen.tsx import sheets have no regression test for accessible={false}"
status: backlog
priority: low
created: 2026-09-13
updated: 2026-09-13
assignee:
labels: [deferred, accessibility, testing, mobile]
github_issue:
---

# HomeScreen.tsx and RecipeEntryHubScreen.tsx import sheets have no regression test for accessible={false}

## Summary

Of the 8 `<BottomSheetModal>` sites fixed in
`todos/archive/P2-2026-09-05-bottomsheetmodal-callers-collapse-a11y-subtree-on-ios.md`,
6 got a prop-pinning test extending an existing co-located test file, but
`client/screens/HomeScreen.tsx:540` and
`client/screens/meal-plan/RecipeEntryHubScreen.tsx:277` have no co-located test
file at all, so their `accessible={false}` fix has zero regression coverage —
a future accidental deletion or a `null` regression would go undetected by
the test suite (jsdom render tests also can't observe the underlying native
leaf-collapse either way, so this is about catching a prop regression, not the
real mechanism).

## Background

Surfaced by the code-reviewer (WARNING) and mobile-reviewer (SUGGESTION)
passes on the BottomSheetModal a11y-leaf fix PR. Both reviewers judged this
consistent with that todo's Scope Contract (creating brand-new test files for
previously-untested screens would itself have been an excluded new file), so
it wasn't fixed inline there — filed here instead per the medium/low
auto-file convention.

The proven pattern to follow is `client/components/__tests__/ConfirmationModal.test.tsx`'s
`"passes accessible={false}..."` test (or the equivalent added to
`client/components/__tests__/BeveragePickerSheet.test.tsx` /
`client/screens/meal-plan/__tests__/RecipeBrowserScreen.params.test.tsx` in
the same PR): render the screen, then assert
`screen.getByTestId("bottom-sheet-modal").getAttribute("data-accessible") === "false"`
using the shared `test/mocks/gorhom-bottom-sheet.ts` mock (already aliased in
`vitest.config.ts` — no new mock needed).

## Acceptance Criteria

- [ ] `client/screens/HomeScreen.tsx`'s import-recipe sheet (`:540`) has a
      test asserting `accessible={false}` is passed to the `BottomSheetModal`.
- [ ] `client/screens/meal-plan/RecipeEntryHubScreen.tsx`'s import-recipe
      sheet (`:277`) has the same assertion.
- [ ] Test name/comment states only what jsdom can prove (the prop was
      passed) — do not claim it proves the native VoiceOver/Maestro behavior.
- [ ] New/extended tests pass under `npx vitest run`.

## Implementation Notes

- Neither screen currently has ANY test file — this todo's minimal viable
  scope is a new, narrowly-focused test file per screen (not a full render
  suite), mirroring the mocking footprint `RecipeBrowserScreen.params.test.tsx`
  or `BeveragePickerSheet.test.tsx` used (mock only the collaborators needed to
  get the screen to render without crashing — navigation, data hooks, heavy
  child components).
- Re-grep current line numbers before editing; the `:540`/`:277` references
  above are as of 2026-09-13.

## Scope Contract

- **Mechanisms to use:** the existing `test/mocks/gorhom-bottom-sheet.ts`
  mock + `renderComponent` test harness — nothing new.
- **Files in scope:** `client/screens/HomeScreen.tsx`,
  `client/screens/meal-plan/RecipeEntryHubScreen.tsx`, and one new co-located
  test file per screen.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. Builds on the already-merged BottomSheetModal a11y-leaf fix.

## Risks

- Low — test-only addition, no production code changes.

## Updates

### 2026-09-13

- Initial creation from code-reviewer/mobile-reviewer findings on the
  BottomSheetModal a11y-leaf fix PR.
