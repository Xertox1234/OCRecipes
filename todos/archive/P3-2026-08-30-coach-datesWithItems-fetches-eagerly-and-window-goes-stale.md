---
title: "CoachChat fetches meal-plan items for every user including free ones, and pins the window at mount so the slot picker's has-items dots drift after midnight"
status: done
priority: low
created: 2026-08-30
updated: 2026-08-30
assignee:
labels: [react-native, coach, performance]
github_issue:
---

# Two small defects in how the coach feeds `datesWithItems` to the slot picker

## Summary

`CoachChat` fetches a week of meal-plan items to drive the "has planned items" dots in the
plan-slot picker. It does so (a) for **every** user, including free users who can never open
that sheet, and (b) using a 7-day window computed once at mount, which goes stale against the
sheet's own per-open window after a date rollover.

## Background

Both were raised during review of the coach "Add to Plan" branch
(`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md`) and left
alone, because both are exactly what that branch's implementation plan prescribed — they are
plan defects, not implementation slips, and neither is user-harmful enough to justify widening
that branch.

Verified against `f73ab7aa` in `client/components/coach/CoachChat.tsx`:

```ts
const planWeek = useMemo(() => buildPlanSlotDays(new Date()), []); // empty deps — pinned at mount
const { data: planItems } = useMealPlanItems(
  planWeek[0].iso,
  planWeek[planWeek.length - 1].iso,
);
const datesWithItems = useMemo(() => toPlannedDateSet(planItems), [planItems]);
```

**(a) Unconditional fetch.** The sheet is reachable only when `usePremiumFeature("catalogSave")`
is true — a free user tapping "Add to Plan" gets the upgrade modal and never sees a dot. The
`GET /api/meal-plan` request is issued regardless, on every coach chat mount.

**(b) Stale window.** `PlanSlotPickerSheet` computes its own `buildPlanSlotDays(new Date())` at
each open, while this query's range is frozen at mount. In a chat session left open across
midnight, the sheet renders day N+1..N+7 while `datesWithItems` only covers N..N+6 — so the last
chip can never show a dot, and the first chip's dot is for a day no longer displayed.

Impact of (b) is cosmetic: the dot is decoration, and the `plannedDate` actually written comes
from the sheet's own freshly-computed days, so nothing is mis-filed.

## Acceptance Criteria

- [x] The meal-plan items query does not fire for users who cannot reach the slot picker
      (gate it on the same `catalogSave` premium check that gates the sheet).
- [x] The fetched window matches the window the sheet actually renders, including after a date
      rollover in a long-lived session.
- [x] A test pins the premium gate: with `catalogSave` false, the items query is not issued.
- [x] No change to which `plannedDate` is written — this todo touches only the dot decoration
      and the fetch, never the value sent to `addMealPlanItem`.

## Implementation Notes

Both are small and independent; do them together since they touch the same three lines.

- **(a)** `useMealPlanItems` already supports being disabled — it is a `useQuery` with
  `enabled: !!startDate && !!endDate` (`client/hooks/useMealPlan.ts:21-33`). Either pass empty
  strings when not premium, or add an explicit `enabled` parameter. Prefer the explicit
  parameter: overloading empty-string arguments to mean "off" is the kind of implicit contract
  that rots.
- **(b)** The cheapest correct fix is to recompute the window when the sheet opens rather than
  at mount — e.g. key the memo on `planTarget !== null` so it refreshes each time the sheet is
  raised. Do NOT recompute on every render; that would change the query key continuously and
  defeat caching.

A tempting third option — having the sheet fetch its own data — should be rejected:
`PlanSlotPickerSheet` is deliberately presentational and takes `datesWithItems` as a prop, which
is what makes it testable without a QueryClient. Keep the fetching in `CoachChat`.

## Scope Contract

- **Mechanisms to use:** the existing `useMealPlanItems` hook, the existing
  `usePremiumFeature("catalogSave")` check, and the existing `buildPlanSlotDays` helper.
- **Files in scope:** `client/components/coach/CoachChat.tsx`,
  `client/components/coach/__tests__/CoachChat.branches.test.tsx`, and
  `client/hooks/useMealPlan.ts` only if an explicit `enabled` parameter is added.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Adding an `enabled` parameter to `useMealPlanItems` touches a shared hook — check its other
  callers (`grep -rn "useMealPlanItems" client/`) before changing its signature; an optional
  trailing parameter keeps existing call sites untouched.
- Changing the query's date range changes its React Query cache key. Confirm this does not cause
  a visible refetch flash in the planner, which uses the same endpoint with its own range.

## Updates

### 2026-08-30

- Filed after the user authorised follow-up todos. Both items are verbatim consequences of the
  originating branch's implementation plan, flagged by its reviewers and deliberately deferred
  rather than widening that branch.
