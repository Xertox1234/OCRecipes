---
title: "Android TalkBack can still reach behind-sheet content on all 8 BottomSheetModal sites — accessibilityViewIsModal is iOS-only and nothing covers the Android side"
status: done
priority: medium
created: 2026-09-20
updated: 2026-09-23
assignee:
labels: [deferred, mobile, accessibility]
github_issue:
---

# The background focus trap exists on iOS only

## Summary

PR #1000 closed the background-focus-trap gap on the 3 BottomSheetModal sites that lacked it, using
`accessibilityViewIsModal`. That prop is **iOS-only**. On Android, TalkBack can still reach and read
the content behind an open sheet on **all 8** sites — the 3 that PR #1000 fixed and the 5 that
already had the iOS trap. The iOS work is done; the Android half has never been started.

## Background — filed because the gap was being cited as already tracked

This todo exists because the gap was **documented as tracked when it was not** — in exactly one
place, which is worth stating precisely because an earlier draft of this file overstated it:

- `docs/solutions/conventions/a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md`
  claimed the Android side was "tracked separately", citing
  `todos/P3-2026-07-02-bottomsheet-android-back-dismiss.md`.

`todos/archive/P2-2026-09-05-bottomsheetmodal-callers-collapse-a11y-subtree-on-ios.md` made **no
such claim**. Checked directly at `fdb7e510^`: its only Android line was "Android is unaffected by
the leaf-collapse ... so this is an iOS-only correctness fix" — a true statement about a **different**
mechanism (the `accessible={false}` leaf-collapse fix from PR #959). That file was simply silent on
the background-trap gap, and PR #1000 **added** the "not tracked by any open todo" note to it as new
content rather than correcting anything.

The cited todo is wrong twice over, verified 2026-09-20: the path does not resolve (it is archived at
`todos/archive/P3-2026-07-02-bottomsheet-android-back-dismiss.md`), and its subject is the Android
**hardware back button** — title "Android hardware back should dismiss open BottomSheetModals, not
navigate beneath them", with **zero** matches for `talkback`, `importantForAccessibility` or
`focus.trap` in the whole file.

Both other Android-TalkBack-focus-trap todos were checked and neither covers this:

| todo                                                                            | status | why it does not cover this                                                             |
| ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `archive/P3-2026-06-22-android-overlay-talkback-focus-trap.md`                  | done   | 0 mentions of `BottomSheetModal`; scoped to in-screen overlays                         |
| `archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md` | done   | Scope Contract names `ConfirmationModal.tsx` and its 8 callers — a different component |

PR #1000 corrected the solutions doc's false citation and added a matching note to the archived
collapse todo, both saying plainly that nothing tracks this. This todo is what makes those statements
obsolete in the right direction.

## The 8 sites

Re-derived from `grep -rn "<BottomSheetModal" client --include='*.tsx'` (quote the glob — the Bash
tool's shell is zsh, which fails `no matches found` on a bare `*.tsx`), excluding
`ConfirmationModal.tsx`, which is a separate already-resolved concern:

- `client/screens/HomeScreen.tsx` — import sheet (renders shared `ImportRecipeSheetContent`)
- `client/screens/meal-plan/RecipeEntryHubScreen.tsx` — import sheet (same shared content)
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — filter sheet
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — four sheets, via
  `client/components/meal-plan/{AddItemMenuSheet,ImportRecipeSheet,QuickAddSheet,SimpleEntrySheet}.tsx`
- `client/components/BeveragePickerSheet.tsx`

Note `client/components/coach/PlanSlotPickerSheet.tsx` is **out of scope** — it uses a plain React
Native `Modal`, not `@gorhom/bottom-sheet`.

## Acceptance Criteria

- [ ] On Android with TalkBack, content behind an open sheet is not reachable by swipe navigation at
      any of the 8 sites. The Android lever is `importantForAccessibility="no-hide-descendants"` on
      the behind-content, not a prop on the sheet — confirm the mechanism before choosing it, since
      the iOS and Android levers work in opposite directions (iOS marks the MODAL, Android hides the
      BACKGROUND).
      PARTIAL, and left unchecked for that reason. 7 of the 8 sites are done: `HomeScreen.tsx`,
      `RecipeEntryHubScreen.tsx`, `RecipeBrowserScreen.tsx`, and `MealPlanHomeScreen.tsx`'s 4 sheets
      (via one derived union of the existing sheet-open state — no new state needed there). Site 8,
      `client/components/BeveragePickerSheet.tsx`, is **deferred**: its actual behind-content is not
      itself but its host screen, `client/screens/PhotoAnalysisScreen.tsx` (confirmed via
      `grep -rn "<BeverageSheet" client` — the sheet is rendered there via
      `useBeverageSheet()`/`usePhotoAnalysis()`, neither of which this screen imports). Wiring an
      `isOpen` signal for that site would require touching `client/hooks/useBeverageSheet.ts`,
      `client/hooks/usePhotoAnalysis.ts`, and `client/screens/PhotoAnalysisScreen.tsx` — none of
      which this todo's own Scope Contract lists (it named `BeveragePickerSheet.tsx` as the site, not
      its real host). Deferred rather than expanding the contract, per this exact codebase's own
      precedent for an identical conflict:
      `todos/archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md`'s
      `CookSessionCaptureScreen`/`CameraView` residual (deferred with a reason, AC left honestly
      partial, no follow-up todo filed — see that file's 2026-09-13 Updates entry). A follow-up todo
      naming those three files as in-scope would need to be filed separately before site 8 can be
      closed.
- [x] Regression tests pin whatever prop is chosen, at each site, in the manner of the existing
      prop-pinning tests. Note the standing constraint: **jsdom cannot assert real a11y-tree
      hiding** — see
      `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`.
      Pin the PROP; do not write an assertion that claims a tree effect it cannot observe.
- [x] Each new assertion is mutation-verified: remove the prop at one site and confirm exactly that
      site's test reddens. An assertion that cannot fail pins nothing.
- [ ] On-device verification on a real Android device or emulator with TalkBack actually enabled.
      Two standing gotchas: `focusable=false` is **not** the same as excluded from the a11y tree, and
      **adb input does not drive TalkBack** — see the TalkBack verification notes before planning
      this step.
      NOT PERFORMED — no Android SDK tooling in the authoring environment (`adb` and `emulator` both
      exit 127). Same standing limitation as the cited `confirmation-sheet` precedent (this project's
      hardware is Apple-only). jsdom prop-pinning tests are the only evidence behind this change
      today; they pin that the props are applied and cannot observe reachability in either direction.
- [x] The two places PR #1000 updated to say nothing tracks this — the solutions doc's Exceptions
      bullet and the archived collapse todo's 2026-09-20 note — are updated to cite this todo, so
      that text does not itself go stale. (Describing the target set by what PR #1000 DID, not by
      the false claim: only the solutions doc ever made one.)

## Implementation Notes

- PR #1000 established where the prop must go: on each sheet's **own content root**, never on
  `BottomSheetModal` — `DraggableView` forwards only `accessible`, `accessibilityRole`,
  `accessibilityLabel` and `accessibilityHint` to its children wrapper. The Android lever targets
  different nodes (the background), so that placement finding does **not** transfer directly; expect
  to touch the screens, not only the sheet components.
- The shared test mocks `test/mocks/react-native.ts` and `test/mocks/gorhom-bottom-sheet.ts` were
  extended by PR #1000 with an `ariaModalProps` helper to make `accessibilityViewIsModal` observable
  in jsdom. An equivalent mapping will likely be needed for `importantForAccessibility`.
- Three of the eight sites render the shared `ImportRecipeSheetContent`, so one change covers them —
  but **grep the rendered child component, not the screen**. That exact mistake produced the wrong
  "6 of 8" count the earlier todo shipped with.

## Scope Contract

- **Mechanisms to use:** the existing React Native accessibility props and the existing shared test
  mocks. No new gate, no new abstraction, no new component.
- **Files in scope:** the 8 sites listed above and their co-located tests, plus
  `test/mocks/react-native.ts` and `test/mocks/gorhom-bottom-sheet.ts` if the prop must be made
  observable.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #1000 (merged, `fdb7e510`) did the iOS half; this is the independent Android half.

## Risks

- `importantForAccessibility="no-hide-descendants"` applied to the wrong node can hide the **sheet**
  rather than the background — a total accessibility regression that a prop-pinning test would
  happily confirm as "working". On-device verification is not optional here.
- The behind-content is a whole screen at most sites, so the prop must be toggled on sheet
  open/close. A trap that is never released leaves the app unusable to TalkBack after the sheet
  closes — that is the failure mode to test for explicitly.

## Updates

### 2026-09-20

- Filed after PR #1000's review established that no open todo covered this gap. The solutions doc
  had claimed otherwise, citing a todo that is archived and about the hardware back button; the
  archived collapse todo made no claim either way and PR #1000 added an accurate note to it. That
  citation, the two candidate todos, and the 8-site inventory were each verified against the tree
  before filing.

### 2026-09-23

- Implemented 7 of the 8 sites. `HomeScreen.tsx`, `RecipeEntryHubScreen.tsx`, and
  `RecipeBrowserScreen.tsx` (all imperative hosts) get a local `useState` boolean set `true`
  alongside the existing `.present()` call and `false` only via a newly-wired `BottomSheetModal`
  `onDismiss` prop (post close-animation, the same asymmetric bias `useSheetBackHandler` already
  uses elsewhere in this codebase — never released early). `MealPlanHomeScreen.tsx` needed no new
  state: its 4 sheets' existing `xxxMealType !== null` booleans (already passed as `isOpen` to each
  sheet's own `useSheetBackHandler` call) are unioned directly. `importantForAccessibility` is
  applied to each screen's own background root — never `accessibilityElementsHidden`, since iOS is
  already trapped separately via `accessibilityViewIsModal` on each sheet's own content root (PR
  #1000).
- **Site 8 (`BeveragePickerSheet.tsx`) deferred** — see AC #1 above for the reasoning
  (`PhotoAnalysisScreen.tsx` is its real host, outside this todo's Scope Contract). Re-deferred
  rather than falsely checked, per the same precedent this todo already cites.
- **AC #4 (on-device TalkBack) NOT performed** — no Android SDK tooling (`adb`/`emulator` both exit 127) in this environment. Re-deferred rather than falsely checked, matching the confirmation-sheet
  precedent's identical AC #3/#4 handling.
- **Review found one CRITICAL, fixed on this branch**: `HomeScreen.tsx`'s collapsed summary bar
  (visible once the user has scrolled past the header-collapse threshold) is a _sibling_ of the
  trapped `ScrollView`, not a descendant — the ScrollView's own `importantForAccessibility` did not
  cover it, and the bar's own accessibility state was driven only by `isBarVisible`, independent of
  the new sheet-open state. Since the "Import a Recipe" action sits in a `CollapsibleSection` far
  down the page, `isBarVisible` is very likely already `true` by the time a user reaches it — so a
  TalkBack user could reach the bar's "Tap for details" button behind the open sheet under a
  realistic interaction sequence. Fixed by composing `isImportSheetOpen` into the bar's existing
  `importantForAccessibility` condition; 4 new tests isolate `isBarVisible` from `isImportSheetOpen`
  to pin all four truth-table cells, mutation-verified. Codify candidate worth generalizing: a
  background trap applied to "the ScrollView" can miss a sibling of that ScrollView that has its own,
  independent visibility condition — enumerate every top-level sibling of the sheet's host, not just
  the obvious scroll container.
- **Worktree provisioning gap hit and resolved**: this session's worktree had no `.env` (the
  `Agent(isolation:"worktree")` dispatch path does not auto-symlink one, unlike a `/todo` executor's
  worktree), so `npm run test:run` initially failed 40 server/storage test files with
  `database "williamtower" does not exist` — a Postgres-unreachable false red, not a regression (zero
  overlap with this diff's client-only files). Symlinked `.env` from the main checkout (gitignored,
  invisible to git) to get a genuine full-suite run: 541/541 files, 8611/8611 tests passed.
