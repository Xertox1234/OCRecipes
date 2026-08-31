---
title: "Grocery-list and receipt-meal-plan screens still derive calendar days from a UTC basis, and unlike the planner they break at BOTH offset signs"
status: backlog
priority: medium
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [deferred, react-native, meal-plan, timezone]
github_issue:
---

# Three client call sites the local-basis fix deliberately did not cover

## Summary

`todos/archive/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md` moved
the meal planner and the coach slot picker onto a device-local date basis. Three other client call
sites still call `toDateString` (UTC) on a **raw instant** to answer "what day is it here". Because
they skip the local-midnight normalisation the planner had, they are wrong at **both** offset
signs, for exactly `|offset|` hours out of every day.

## Background

Found 2026-08-31 during the caller enumeration for that P1. They were left out of its Scope
Contract, which named the planner and the picker only.

Measured against `2f2acd2c` by reproducing each call site and sweeping all 24 local hours of
2026-09-02:

| TZ                    | offset | `toDateString(new Date())` wrong | `getPlannedDate("2026-09-01", 0)` |
| --------------------- | ------ | -------------------------------- | --------------------------------- |
| `UTC`                 | 0      | 0 / 24 h                         | `2026-09-01` ✓                    |
| `Europe/Berlin`       | +2     | 2 / 24 h (local 00:00–01:59)     | `2026-09-01` ✓                    |
| `Pacific/Auckland`    | +12    | 12 / 24 h (local 00:00–11:59)    | `2026-09-01` ✓                    |
| `Pacific/Apia`        | +13    | 13 / 24 h                        | **`2026-08-31` ✗**                |
| `Pacific/Kiritimati`  | +14    | 14 / 24 h                        | **`2026-08-31` ✗**                |
| `America/Los_Angeles` | −7     | 7 / 24 h (local 17:00–23:59)     | `2026-09-01` ✓                    |

Note the contrast with the planner defect: that one was UTC-positive-only and constant, because a
local-midnight instant is always ≤ 24 h from UTC midnight. These use the raw instant instead, so
positive offsets break in the early morning and negative offsets break in the late evening.

### The call sites

| File                                                       | Code                                           | Effect                                                              |
| ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- | ------ | ----------------------------------- |
| `client/screens/meal-plan/GroceryListsScreen.tsx:54-62`    | `toDateString(new Date())`, then `+6` days     | grocery-list range defaults start a day off in the window above     |
| `client/components/GroceryListPickerModal.tsx:97-99`       | same, plus `Date.now() + 7*24*60*60*1000`      | same, and the `+7 days` is 168 **hours** — a DST week is 167 or 169 |
| `client/screens/meal-plan/ReceiptMealPlanScreen.tsx:61-65` | `getTomorrowDate()` — raw instant `+1` day     | receipt-import default lands on the wrong day in the same window    |
| `client/screens/meal-plan/ReceiptMealPlanScreen.tsx:55-59` | `getPlannedDate()` — `new Date(s+"T12:00:00")` | \*\*local-noon trick; correct for `                                 | offset | < 13`, wrong all day at +13/+14\*\* |

`getPlannedDate` is the interesting one: parsing `"...T12:00:00"` with no `Z` gives local noon,
which is deliberately far enough from both UTC midnights to survive the conversion — a real
technique, just one whose stated safety margin is 12 hours, and `Pacific/Apia` (+13) and
`Pacific/Kiritimati` (+14) exceed it. It writes `plannedDate` values that reach
`server/routes/meal-plan.ts:768`, so this is a genuine (if tiny-population) data bug, not a
display-only one.

## Acceptance Criteria

- [ ] Each of the four call sites above answers "what calendar day is it on this device" using the
      local basis (`toLocalDateString` from `shared/lib/date.ts`, added by the P1 work), not
      `toDateString` on a raw instant.
- [ ] The `+7 days` in `GroceryListPickerModal` is calendar arithmetic (`setDate(getDate() + 7)`),
      not `+ 7*24*60*60*1000`, so a DST week is still seven calendar days.
- [ ] `getPlannedDate` no longer depends on a noon offset margin; it derives the day from local
      calendar components and is correct at +13 and +14.
- [ ] Tests pin at least one positive and one negative non-UTC zone, at an hour inside each one's
      failing window (per the table above). CI runs UTC, where every one of these is silently
      correct.

## Implementation Notes

`toLocalDateString` already exists in `shared/lib/date.ts` with a doc comment on when to use it
versus `toDateString`. This is mostly a mechanical swap; the two that need real thought are the
`+7*24*60*60*1000` arithmetic and `getPlannedDate`'s noon trick.

For `getPlannedDate(startDate, dayOffset)` the input is already a `yyyy-mm-dd` string, so the
robust form parses the components directly (`new Date(y, m - 1, d + dayOffset)`) and formats with
`toLocalDateString` — no parse-then-reformat round-trip through a UTC instant at all.

Check whether the grocery-list range is even meant to be device-local before changing it: unlike
`planned_date`, `grocery_lists.date_range_start/end` may be intended to line up with the meal-plan
days it is generated from, in which case matching the planner is the requirement and "local" is
just how that is spelled.

## Scope Contract

- **Mechanisms to use:** the existing `toLocalDateString` helper — no new date library, no
  migration.
- **Files in scope:** `client/screens/meal-plan/GroceryListsScreen.tsx`,
  `client/components/GroceryListPickerModal.tsx`,
  `client/screens/meal-plan/ReceiptMealPlanScreen.tsx`, and co-located tests for each.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. `toLocalDateString` landed with the P1 fix.

## Risks

- The grocery-list date range is sent to the server and stored; confirm the intended semantics
  (see Implementation Notes) before changing the basis, or this trades one wrong answer for
  another.
- A test that does not pin a non-UTC `TZ`, **at an hour inside the failing window**, passes in CI
  while the defect stays live. Unlike the planner defect these are time-of-day dependent, so the
  hour matters as much as the zone — see
  `todos/P2-2026-08-31-plan-slot-timezone-guards-never-run-in-ci.md`.

## Updates

### 2026-08-31

- Filed from the caller enumeration performed during the P1 local-date-basis work, with the
  per-zone failure windows measured rather than estimated.
