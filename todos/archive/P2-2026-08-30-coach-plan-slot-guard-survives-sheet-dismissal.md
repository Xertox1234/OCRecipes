---
title: "Dismissing the coach plan-slot sheet mid-save leaves the mutation in flight, so one flow's `finally` can clear a later flow's double-submit guard"
status: done
priority: medium
created: 2026-08-30
updated: 2026-08-30
assignee:
labels: [react-native, coach, meal-plan, data-integrity]
github_issue:
---

# The double-submit guard is single-slot, and dismissal doesn't end the flow it guards

## Summary

`CoachChat`'s `isSavingPlanRef` guard prevents a double-tap from writing two `meal_plan_items`
rows. But dismissing the slot-picker sheet does not cancel or track the in-flight save, so a
late `finally` from an abandoned flow can release the guard belonging to a _later_ one —
reopening the double-write window it exists to close.

## Background

Raised by two reviewers during the coach "Add to Plan" branch
(`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md`) and
consciously accepted there rather than fixed, because the obvious fix was worse. Recorded as
Ruling 10 in that branch's decision ledger.

The mechanics, verified against `f73ab7aa`:

- `client/components/coach/PlanSlotPickerSheet.tsx` gates `isSubmitting` on the Confirm button
  **only** (`:80`, `:86`, `:91`, `:249`). Every dismissal path is unconditional —
  `onRequestClose` (`:103`), the backdrop `Pressable` (`:114-115`), and the visible Close
  button (`:130`).
- `client/components/coach/CoachChat.tsx` wires `onDismiss={() => setPlanTarget(null)}`,
  also unconditional.
- `isSavingPlanRef` (`CoachChat.tsx:141`) is a single boolean shared across sequential flows,
  acquired at `:504-505` and released in `finally` at `:525`.

So: confirm on recipe A (guard acquired, a slow Spoonacular `saveCatalogRecipe` in flight) →
dismiss the sheet by any route → reopen and confirm on recipe B → B acquires the guard → **A's
`finally` fires and clears B's guard mid-flight**, leaving B open to a double-tap for the
remainder of its round trip.

The reciprocal case — A's stale guard silently swallowing B's first confirm — is already handled
by the reset `useEffect` at `CoachChat.tsx:496-500`, which fires on `planTarget`'s
null→non-null transition. That effect was nearly deleted as dead code during review; it is not.
Its comment now names this mechanism.

## Why the obvious fix was rejected

Gating the sheet's dismissal on `isSubmitting` closes this cleanly, and was deliberately not
done: it can trap the user inside a non-dismissable modal behind a hung request. That failure
mode was judged worse than this race — but the race's own cost is a **duplicate
`meal_plan_items` row that nothing catches**, not a race that "self-heals": `shared/schema.ts`'s
`mealPlanItems` table (`~:897-931`) has no unique constraint over
`(userId, plannedDate, mealType, recipeId)`, only two indexes and two CHECKs (verified directly
against the table definition), so a second write from B's reopened double-tap succeeds and
persists as a second row. Any fix here must not reintroduce the dismissal trap.

## Acceptance Criteria

- [ ] A save that was abandoned by dismissing the sheet can no longer affect the guard state of
      a subsequent save. Whichever mechanism is chosen, the sheet must remain dismissable at all
      times — do not gate dismissal on `isSubmitting`.
- [ ] A test drives the actual interleaving: start save A (leave its promise pending), dismiss,
      open B, confirm B, then resolve A — and assert B's guard is still held, i.e. a second
      confirm on B does not produce a second `addMealPlanItem` call.
- [ ] The existing pair of guard tests still pass and still bracket the guard: one pins the
      ACQUIRE (a synchronous double-tap calls `saveCatalog` once), the other pins the RELEASE
      (after a failure, a retry calls `saveCatalog` again).
- [ ] Decide whether the reset `useEffect` at `CoachChat.tsx:496-500` is still needed once the
      guard is per-flow, and record the answer. If it becomes genuinely unreachable, delete it —
      but only with the reasoning written down, since it was already nearly deleted once on a
      wrong unreachability argument.

## Implementation Notes

The root cause is that a boolean ref cannot distinguish _which_ flow released it. Options, in
rough order of preference:

1. **Token/generation guard.** Replace the boolean with a counter or a per-attempt token: each
   confirm captures the current token, and the `finally` only clears the guard if the token it
   captured is still the active one. Small, local to `CoachChat`, and directly models "this
   release belongs to that acquire".
2. **Key the guard by target.** Store the in-flight `recipeId` rather than a boolean. Slightly
   leakier — it does not handle the same recipe being retried twice.
3. **Abort the in-flight request on dismiss.** Most thorough, most invasive: needs an
   `AbortController` threaded through `apiRequest`. Probably out of proportion here, and it
   raises its own question — the server may already have written the row.

Whichever is chosen, note that `POST /api/meal-plan/catalog/:id/save` is idempotent by
external-id lookup (`server/routes/recipe-catalog.ts:187-191`), so a repeated _save_ creates no
duplicate recipe rows. The duplicate risk is entirely in the second step,
`POST /api/meal-plan/items`, which happily writes two identical rows.

Worth pinning while here (raised by the same review, deliberately deferred): a dedicated test
for the reset effect's own reachability, rather than leaving it justified by a code comment.
See `docs/solutions/conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md`.

## Scope Contract

- **Mechanisms to use:** the existing `isSavingPlanRef` guard and the existing mutation hooks —
  no request-cancellation infrastructure unless option 3 is deliberately chosen and justified.
- **Files in scope:** `client/components/coach/CoachChat.tsx`,
  `client/components/coach/__tests__/CoachChat.branches.test.tsx`, and
  `client/components/coach/PlanSlotPickerSheet.tsx` only if the chosen fix genuinely requires it.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The branch that introduced this has its own guard tests already in place.

## Risks

- **Do not gate dismissal on `isSubmitting`** to close this — see "Why the obvious fix was
  rejected". A reviewer independently agreed with that call.
- The window is narrow to enter (it needs a dismissal mid-save, a prompt reopen, and a
  double-tap inside the remainder of the first request) but its outcome, once entered, is not
  narrow: it writes a duplicate `meal_plan_items` row that nothing in the schema catches (no
  unique constraint over `(userId, plannedDate, mealType, recipeId)` — verified, see "Why the
  obvious fix was rejected"). Weigh the fix's complexity against that; a token guard is cheap, an
  `AbortController` refactor is not.

## Updates

### 2026-08-30

- Filed after the user authorised follow-up todos. Accepted as a known residual during the
  coach "Add to Plan" branch (Ruling 10 in that branch's ledger) rather than fixed, because the
  clean fix trades a rare race for a modal that can trap the user.
- **Corrected the same day**, during that branch's final-review fix wave: verified
  `shared/schema.ts`'s `mealPlanItems` table has no unique constraint over
  `(userId, plannedDate, mealType, recipeId)`. The residual is not a race that "self-heals" — it
  writes a duplicate plan row that nothing in the schema catches. "Why the obvious fix was
  rejected" and Risks updated accordingly; priority (`medium`) was already appropriately set for
  a narrow-entry, real-write defect and is unchanged.

### 2026-09-01

- Implemented Option 1 (token/generation guard) from Implementation Notes: a new
  `planSaveTokenRef` counter in `CoachChat.tsx` is bumped on every confirm and on every
  reopen (the existing reset `useEffect`); the guard's release (`finally`) and both
  `setPlanTarget(null)` completions (success and terminal-failure) now act only when their
  captured token still matches the current one.
- **AC #4 answer: the reset `useEffect` (dismissal-vs-reopen reset of `isSavingPlanRef`) is
  still needed, not redundant with the new token, and was NOT deleted.** The two mechanisms
  guard opposite sides of the same problem: the effect is what lets a LATER flow ACQUIRE the
  guard despite an abandoned earlier flow still holding it (without it, a second confirm would
  bail at the `isSavingPlanRef.current` check before ever assigning a token); the token governs
  only whether a flow's own RELEASE and completion still apply once acquired. This is a
  mechanically-checkable answer (deleting the effect measurably changes the ACQUIRE path), not a
  reachability argument — see `docs/solutions/conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md`.
  Recorded in the `CoachChat.tsx` comment beside the effect, and here.
- **Review caught a gap in the first draft of the token guard**, found via construct-and-run
  reasoning (not just re-reading the diff): the reset effect cleared `isSavingPlanRef` on reopen
  but left `planSaveTokenRef` untouched, so an abandoned flow's still-matching token could settle
  and close a sheet that had been reopened but not yet re-confirmed — a narrower, arguably more
  likely window than the originally-tested "confirm B immediately" case. Fixed by also bumping
  `planSaveTokenRef` in the reset effect. Two regression tests pin this: one for the
  reopened-but-unconfirmed window, one for the parallel terminal-failure close path (402/422/404)
  that the original interleaving test didn't exercise. Both fixes were mutation-tested (each
  guard temporarily removed, confirmed its own test goes red, then restored).
