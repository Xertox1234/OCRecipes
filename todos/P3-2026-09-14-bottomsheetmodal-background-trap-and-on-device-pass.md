---
title: "3 of 8 BottomSheetModal sites have no background focus trap (corrected from an original count of 6), and the per-site on-device a11y pass was never run"
status: in-progress
priority: low
created: 2026-09-14
updated: 2026-09-20
assignee:
labels: [deferred, accessibility, mobile]
github_issue:
---

# BottomSheetModal background trap gap + the deferred on-device pass

## Summary

Two loose ends from the `accessible={false}` sweep (PR #959), both acknowledged
in code comments there but previously untracked:

1. After that PR, only **2 of its 8** sheet sites isolate the content _behind_
   the sheet from the screen reader. The other 6 have no background trap.
   **Correction during implementation (2026-09-20): this count was wrong.**
   Only 3 of the 6 named "has none" sites actually lacked the trap — see
   "Scope Contract — correction" below for the corrected inventory. The
   original premise here undercounted `ImportRecipeSheetContent` (a shared
   component 3 of the 6 sites render) as already having the fix.
2. Acceptance criterion #2 of
   `todos/archive/P2-2026-09-05-bottomsheetmodal-callers-collapse-a11y-subtree-on-ios.md`
   — per-site Maestro `inspect_screen` verification on a booted sim — was not
   performed for any of the 8 sites.

They are filed together because both are settled in one device session.

## Background

PR #959 fixed a _different_ defect: the sheet's own content collapsing into a
single iOS accessibility leaf. Background isolation was correctly out of its
scope. But `client/screens/meal-plan/MealPlanHomeScreen.tsx` carries a comment
saying "These 4 sheets have NO tracked focus-trap follow-up", and per
`CLAUDE.md` → Deferred Item Todos an acknowledged Low-severity gap is the tier
that auto-files rather than living in a comment. This file is that artifact.

Which sites have a working trap today, per review of #959:

- **Has one:** `client/components/BeveragePickerSheet.tsx` (inner
  `<View accessibilityViewIsModal>`), `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  (inner `<BottomSheetView accessibilityViewIsModal>`).
- **Has none:** `client/screens/HomeScreen.tsx`, all 4 sheets in
  `client/screens/meal-plan/MealPlanHomeScreen.tsx`, and
  `client/screens/meal-plan/RecipeEntryHubScreen.tsx`.

The fix shape is already proven in this codebase — one line per site, on the
sheet's own inner content `View` / `BottomSheetView`.

**Why it must go on the inner view and not the wrapper.** `accessibilityViewIsModal`
placed on `<BottomSheetModal>` reaches no native view: `BottomSheetModal` spreads
`...bottomSheetProps` onto `<BottomSheet>` (`BottomSheetModal.tsx:61,547`), and
`BottomSheet` has no rest-spread at all, forwarding only `accessible`,
`accessibilityRole` and `accessibilityLabel` (`BottomSheet.tsx:1829-1831`).
`BottomSheetView` _does_ spread `...rest` onto a real `<View>`
(`BottomSheetView.tsx:18,84`), which is why it works there. Dead
`accessibilityViewIsModal` props on the wrapper were removed in #959 for exactly
this reason — do not reintroduce them.

## Acceptance Criteria

- [x] Each of the 6 sites above isolates its behind-content from VoiceOver /
      TalkBack while its sheet is presented, using the inner-view placement
      described above.
      **Correction during implementation: only 3 of the 6 sites named below
      actually lacked the trap** — see "Scope Contract — correction" below.
      HomeScreen, MealPlanHomeScreen's import-recipe sheet, and
      RecipeEntryHubScreen all render the shared `ImportRecipeSheetContent`,
      which already carried the prop from an earlier PR. The 3 real gaps
      (`AddItemMenuSheet.tsx`, `QuickAddSheet.tsx`, `SimpleEntrySheet.tsx`)
      now all set it on their own content View.
- [x] A regression test pins the prop at each newly-trapped site, in the manner
      of the existing `accessible={false}` prop-pinning tests.
      Added/extended for the 3 real-gap sites. Required extending
      `test/mocks/react-native.ts` (`mockComponent`) to map
      `accessibilityViewIsModal` → `aria-modal`, mirroring the existing
      `ariaHiddenProps` precedent — without it the prop is invisible to jsdom
      entirely (empirically verified), so there was no way to pin it otherwise.
- [ ] Per-site `inspect_screen` verification on a booted simulator for all 8
      sheet sites confirms the sheet's own children are reachable as individual
      descendants — closing AC #2 of the archived todo named above.
      **Deliberately left unchecked.** Not performed: `EXPO_PUBLIC_DOMAIN` was
      unset and no dev server was reachable in this session (no `.env` in this
      worktree; `curl http://localhost:3000/api/health` failed to connect), so
      no simulator/E2E debugging was attempted per the project's "check the API
      IP first" rule. A session with a working dev server + booted simulator
      needs to run this for all 8 sites. `QuickAddSheet.tsx` is the
      highest-priority site to verify first — it's the only one of the 3
      real-gap sites with a structural layout change (a new wrapping `View`
      around its `BottomSheetFlatList`), reviewed as not-obviously-unsafe but
      genuinely unverified without a device/simulator pass.
- [x] That archived todo is updated to record the result.

## Implementation Notes

jsdom render tests cannot observe the native leaf-collapse or the modal trap in
either direction; they can only pin that the prop was passed. Say so in test
names rather than implying native verification, matching the convention the
existing tests already follow.

For the device pass, the dev loop supports Maestro `inspect_screen` against a
booted sim. Note the project's hardware is Apple-only, so the iOS pass is the
one that can be automated here; an Android TalkBack equivalent needs an emulator
and `adb input` does not drive TalkBack.

## Scope Contract

- **Mechanisms to use:** `accessibilityViewIsModal` on each sheet's existing
  inner content view — no new component, no wrapper, no context.
- **Files in scope:** the 6 screens listed above, their co-located tests, and
  `todos/archive/P2-2026-09-05-bottomsheetmodal-callers-collapse-a11y-subtree-on-ios.md`.
- No new mechanisms, files, or abstractions beyond those listed.

### Correction — requires explicit human sign-off before/at merge

This todo's own file list above was written under an incorrect premise (see
the corrected AC #1). Actual site inventory, verified against the live source:

| Site                                         | Trap before this PR | Where the trap actually lives                  |
| -------------------------------------------- | ------------------- | ---------------------------------------------- |
| `HomeScreen.tsx` import sheet                | already had it      | `ImportRecipeSheet.tsx:288` (shared component) |
| `RecipeEntryHubScreen.tsx` import sheet      | already had it      | same shared component                          |
| `MealPlanHomeScreen.tsx` import-recipe sheet | already had it      | same shared component                          |
| `MealPlanHomeScreen.tsx` add-item-menu sheet | **missing**         | fixed: `AddItemMenuSheet.tsx`                  |
| `MealPlanHomeScreen.tsx` quick-add sheet     | **missing**         | fixed: `QuickAddSheet.tsx`                     |
| `MealPlanHomeScreen.tsx` simple-entry sheet  | **missing**         | fixed: `SimpleEntrySheet.tsx`                  |

Three consequences that deviate from the Scope Contract's literal "files in
scope" bullet — the mechanism clause ("on each sheet's existing inner content
view") is what actually got implemented, since that is where the fix is
physically possible, but this is a judgment call the executor made
unilaterally. The code-reviewer flagged it (2 CRITICAL findings) as needing
explicit human ratification rather than silent resolution — its own
assessment: the mechanism-clause interpretation is reasonable on the merits,
but the deviation itself should be surfaced for sign-off, not settled
silently.

1. **The 3 real-gap sites' edits landed in `client/components/meal-plan/
{AddItemMenu,QuickAdd,SimpleEntry}Sheet.tsx`**, not in
   `MealPlanHomeScreen.tsx` (which the contract literally names) — each
   sheet's "existing inner content view" lives in its own content component,
   not inline in the screen.
2. **`QuickAddSheet.tsx` had no existing single content root** (it returned a
   bare Fragment of 3 siblings: header, search, `BottomSheetFlatList`).
   Closing this site required introducing a new `<View accessibilityViewIsModal>`
   wrapper — the one thing the contract's "no new wrapper" clause was written
   to exclude. A `Fragment` cannot carry a prop, so satisfying AC #1 here
   required _some_ new element. A partial flag on only one sibling (e.g. just
   the header) was considered and rejected: the established convention in
   this codebase is a single content-root View carrying the prop (see
   `docs/solutions/conventions/a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md`),
   a partial flag on one sibling doesn't match that shape, and per
   `docs/solutions/logic-errors/accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md`
   (which documents that the prop only suppresses siblings ordered _before_
   it, not after) a header-only flag would leave anything rendered before the
   header — none exists here, but nothing enforces that staying true — outside
   containment. Not independently verified on-device that a header-only flag
   would fail; the regression this reasoning guards against is pinned by a
   jsdom test only (see the QuickAddSheet test's mutation-check comment). A
   plain `View` (not `BottomSheetView`) was used deliberately — see the code
   comment at `QuickAddSheet.tsx` for why.
3. **`test/mocks/react-native.ts` (shared test infrastructure, not a
   "co-located test" of any of the 6 named screens) was extended** to map
   `accessibilityViewIsModal` → `aria-modal` in the jsdom mock — without this,
   the prop is completely invisible to jsdom (empirically verified: it leaves
   zero trace in the rendered DOM), so AC #2's regression tests had no way to
   pin it otherwise. The extension mirrors an existing precedent
   (`ariaHiddenProps`) in the same function.
4. **`test/mocks/gorhom-bottom-sheet.ts` (also shared test infrastructure) was
   additionally extended** in round 2, after both dispatched reviewers
   (code-reviewer as a SUGGESTION, mobile-reviewer as a WARNING) independently
   flagged that its separately-hand-rolled `BottomSheetView`/
   `BottomSheetScrollView` mocks did not go through the same `mockComponent`
   helper and so would NOT make `accessibilityViewIsModal` observable for the
   pre-existing `BottomSheetView`-based trap at `RecipeBrowserScreen.tsx:1071`
   — a real gap this PR's new test convention would otherwise silently
   mis-lead a future author into. Fixed by exporting the same `ariaModalProps`
   helper from `test/mocks/react-native.ts` and reusing it there.
5. **`client/screens/__tests__/NutritionDetailScreen.test.tsx` (not one of the
   6 named screens or their tests) was touched** — comment-only — to correct
   two now-factually-false claims ("`accessibilityViewIsModal` never reaches
   the DOM... for either branch") that the `aria-modal` mapping above falsified
   for any future reader of that file. No test logic changed.

This PR will be held by `scripts/todo-automerge-guard.sh`'s PATH gate
regardless of this todo's `low` priority — `test/mocks/react-native.ts` and
`test/mocks/gorhom-bottom-sheet.ts` are not on the safe-path allowlist — so it
will get individual human review before merge rather than auto-merging. That
review is where this deviation needs explicit sign-off.

## Dependencies

- Builds on PR #959, which must land first.
