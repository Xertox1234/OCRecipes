<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "useSheetBackHandler: close-animation, focus-scoping, and double-tap edge cases"
status: done
priority: low
created: 2026-07-07
updated: 2026-07-07
assignee:
labels: [deferred, ui-ux, android, follow-up]
github_issue:

---

# useSheetBackHandler: close-animation, focus-scoping, and double-tap edge cases

## Summary

PR #543's 8-angle review confirmed three real but narrow edge cases in `useSheetBackHandler` (`client/hooks/useSheetBackHandler.ts`) and its `MealPlanHomeScreen` wiring, plus a structural gap where nothing enforces future `BottomSheetModal` hosts actually wire the hook. None of these are regressions — before PR #543, hardware back did nothing useful on any open sheet; after, it works correctly for the overwhelmingly common settled-open case. These are incomplete coverage of corner cases in a new feature, not new breakage, and none were fixed inline (per advisor guidance: timing-sensitive Android-back fixes need on-device verification this session couldn't perform, same limitation the PR's own author hit).

## Background

Discovered during the review-skill's 8-angle diff review of PR #543 (`Android hardware back dismisses open BottomSheetModals`), with each item independently confirmed/plausible-verified by a dedicated verifier agent.

## Acceptance Criteria

- [x] **Close-animation dead window on state-driven hosts** (CONFIRMED — `client/screens/meal-plan/MealPlanHomeScreen.tsx:798-822`, `client/hooks/useSheetBackHandler.ts:53-58`): state-driven hosts (`MealPlanHomeScreen`'s 4 sheets) mirror the `isOpen` boolean straight into `isOpenRef` with no closing-animation grace period — unlike imperative hosts, which deliberately stay "open" until `onSheetChange(-1)` confirms full close. When an in-sheet action (e.g. `handleChooseRecipe`) synchronously nulls the meal-type state, `isOpenRef` flips `false` before the sheet's ~300ms close animation visually finishes; a back press in that window falls through to React Navigation instead of being consumed. Fix requires wiring `onSheetChange`/`onSheetAnimate` onto the 4 state-driven `BottomSheetModal`s too (composing with `quickAdd`/`simpleEntry`'s existing `onChange` handlers, which currently do unrelated focus management) so closing is confirmed by animation-complete, not by the boolean flip.
- [x] **Global listener not focus-scoped** (CONFIRMED — `client/hooks/useSheetBackHandler.ts:81-88`): the `hardwareBackPress` listener gates only on `isOpenRef`, with no `useIsFocused()` check. Confirmed reachable via deep-link/push-notification navigation: `client/App.tsx`'s notification-response handler calls `navigationRef.navigate(...)` directly (no touch, no sheet-dismissal step) to push a root-stack sibling screen, blurring (not unmounting) a tab screen like `MealPlanHomeScreen` without clearing its sheet state. A stale listener from the blurred screen can then consume a back press meant for the newly-focused screen. Fix: gate the listener on `useIsFocused()` in addition to `isOpenRef`.
- [x] **Double-tap race on `AddItemMenuSheet` rows** (PLAUSIBLE, needs on-device confirmation — `client/components/meal-plan/AddItemMenuSheet.tsx:38-51`, `client/screens/meal-plan/MealPlanHomeScreen.tsx:798-822`): `handleChooseRecipe`/`handleSimpleEntry`/`handleImportRecipe` have no double-press guard (unlike `ConfirmationModal`'s `isActioning.current` pattern). A near-simultaneous two-finger tap on two different rows could, via the `InteractionManager.runAfterInteractions` deferral, leave two of the four meal-type states non-null at once — two distinct `BottomSheetModal`s presented, with `BackHandler`'s LIFO listener order potentially dismissing the wrong one. One deterministic chained flow (Quick Add → Import) was checked and found safe (`onDismiss()` called synchronously before navigating); no other deterministic single-tap repro was found, so this needs a device-level double-tap test to confirm. Fix (low-risk, matches existing codebase convention): add an `isActioning.current`-style guard to `AddItemMenuSheetContent`'s three handlers.
- [x] **No enforcement for future `BottomSheetModal` hosts** (PLAUSIBLE, real gap but reasonably out of scope for #543 — `client/hooks/useSheetBackHandler.ts`): nothing (lint rule, pre-commit scanner, test) catches a future host that adds a `BottomSheetModal` without wiring `useSheetBackHandler`, silently regressing the original bug for that host. Repo precedent exists for this class of check: `scripts/check-accessibility.js` and `scripts/check-hardcoded-colors.js` pre-commit-scan `client/**/*.tsx` for structurally identical "component present without required companion" defects. Consider a `scripts/check-bottomsheet-backhandler.js` (grep for `<BottomSheetModal` JSX lacking a `useSheetBackHandler(` call in the same file) or an `eslint-plugin-ocrecipes` AST rule.

## Implementation Notes

- All four items live in or around `client/hooks/useSheetBackHandler.ts` and its `MealPlanHomeScreen.tsx` call sites — likely a single focused PR rather than 4 separate ones, since items 1 and 2 both touch the same hook internals.
- Any fix to item 1 or 2 needs on-device Android verification (emulator or physical device) before merging — this is exactly the verification gap PR #543's own author hit (see `todos/archive/P3-2026-07-02-bottomsheet-android-back-dismiss.md` Updates), so budget time for that rather than shipping on unit-test coverage alone.
- Item 3's fix is small and low-risk (mirror `ConfirmationModal`'s existing `isActioning.current` pattern) and could be split off and landed independently of items 1/2 if device access is the bottleneck.

## Dependencies

- None — all items are follow-ups to the already-merged `client/hooks/useSheetBackHandler.ts` (PR #543).

## Risks

- Items 1 and 2 are timing/navigation-state edge cases — any fix needs careful on-device testing to avoid a regression in the common (settled-open) case that PR #543 already handles correctly.

## Updates

### 2026-07-07

- Filed from PR #543's review (8 finder angles + 7 verifier agents). See PR #543 review comments for full verifier reasoning per item.

### 2026-07-09

- Implemented all four items: (1) `useSheetBackHandler`'s `isOpen`-mirror effect now only ever opens the ref — closing is confirmed exclusively by `onSheetChange(index === -1)` — and all 4 state-driven `BottomSheetModal`s in `MealPlanHomeScreen.tsx` were wired with `onChange`/`onAnimate`; (2) the hook now gates on `useIsFocused()` in addition to the open ref; (3) `AddItemMenuSheetContentInner`'s three handlers got an `isActioning.current` double-tap guard; (4) added `scripts/check-bottomsheet-backhandler.js` (wired into lint-staged + CI).
- Per the Risks section and this todo's own Implementation Notes, items 1 and 2 are timing-sensitive Android hardware-back fixes that this automated session had no on-device emulator/physical-device access to verify — covered by unit tests (Vitest/jsdom `renderHook`) only. **On-device Android verification is still recommended before relying on this in production**, per the same limitation the PR #543 author hit. The PR is routed to individual human review (not auto-merge) for this reason.
- Code review (code-reviewer + mobile-reviewer) surfaced one real gap (new checker script wasn't wired into CI, fixed) and a genuine architectural fragility: correct same-screen sheet-crossover back-press handling depends on the declaration order of the 4 `useSheetBackHandler(...)` calls in `MealPlanHomeScreen.tsx` (Android's `BackHandler` is LIFO) — documented inline with a comment; no code change needed since current order is already correct.
