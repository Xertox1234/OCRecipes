---
title: "MealPlanHomeScreen's date strip displays LOCAL day numbers but keys every item by a UTC ISO date — evening entries land on the next day"
status: backlog
priority: high
created: 2026-08-30
updated: 2026-08-30
assignee:
labels: [react-native, meal-plan, data-integrity, timezone]
github_issue:
---

# The planner's date strip shows one day and reads/writes another

## Summary

`MealPlanHomeScreen` builds and renders its 7-day strip using **local** date math, but keys
every meal-plan read and write by `formatDate(date)` → `toISOString()`, which is **UTC**. For
any user west of UTC, from roughly late afternoon until local midnight, the chip labelled with
today's number is reading and writing _tomorrow's_ data.

## Background

Found on 2026-08-30 while implementing
`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md` (the coach
"Add to Plan" branch). The new coach slot picker originally had the identical defect — the
implementation plan specified the same mixed basis — and it was caught there by a
discriminating test run under `TZ=Pacific/Auckland`. `client/components/coach/plan-slot-picker-utils.ts`
now derives **every** field from the same UTC calendar day and carries a comment explaining why.
This todo is the same fix applied to the pre-existing planner, which was left untouched because
it was out of that branch's scope.

Verified against `f73ab7aa`:

| Where                                                                                      | Basis     | Line                             |
| ------------------------------------------------------------------------------------------ | --------- | -------------------------------- |
| `weekStart.setDate(weekStart.getDate() - weekStart.getDay())`, then `addDays`              | **local** | `MealPlanHomeScreen.tsx:606-611` |
| `DateStripItem` weekday initial — `date.toLocaleDateString("en-US", { weekday: "short" })` | **local** | `:149-150`                       |
| `DateStripItem` day number — `date.getDate()`                                              | **local** | `:152`                           |
| `DateStripItem` spoken a11y label — `date.toLocaleDateString(...)`                         | **local** | `:166`                           |
| `selectedDateStr = formatDate(selectedDate)` — the add/read key                            | **UTC**   | `:572`                           |
| `startDate` / `endDate` for the items query                                                | **UTC**   | `:613-614`                       |

`formatDate` is `formatDateISO` from `@/lib/format`, a re-export of `toDateString` in
`shared/lib/date.ts:2-4`, which is `date.toISOString().split("T")[0]` — UTC, unconditionally.

### The user-visible symptom

At 18:00 on Saturday in `America/Los_Angeles`, `new Date()` is already Sunday 01:00 UTC.
The strip highlights the chip rendering `getDate()` → **Saturday's** number, while
`selectedDateStr` is **Sunday's** ISO string. So:

1. A meal added on Saturday evening is written with `plannedDate` = Sunday.
2. The next morning — once local and UTC agree again — that item appears under the **Sunday**
   chip, having visibly "moved" off the day the user chose.
3. The same skew silently shifts the whole 7-day fetch window, so the last day of the visible
   strip is never covered by the query.

This affects every user in the Americas every evening. It is not a display-only cosmetic issue:
the _written_ `plannedDate` is the wrong day.

## Acceptance Criteria

- [ ] The day number, weekday initial, and spoken accessibility label rendered for a chip are
      derived from the same calendar day as the ISO key that chip reads and writes. A chip
      labelled "30" must never fetch or write `…-31`.
- [ ] A test pins this with a fixed non-UTC timezone (run the suite under a `TZ` where the
      offset actually moves the date, e.g. `TZ=America/Los_Angeles` with a late-evening clock, or
      `TZ=Pacific/Auckland` with an early-morning one). A test that passes only in UTC does not
      close this.
- [ ] The 7-day fetch window (`startDate`/`endDate`, `:613-614`) covers exactly the seven days
      the strip renders.
- [ ] Decide and record which basis wins — see Implementation Notes; do not leave the two mixed.
- [ ] No existing meal-plan item's stored `plannedDate` is rewritten by this change. This is a
      display/derivation fix, not a data migration.

## Implementation Notes

**The basis decision is the whole task; the edit is small.** Two coherent options:

1. **All-UTC** (what `plan-slot-picker-utils.ts` chose): use `setUTCDate`/`getUTCDate` and
   `toLocaleDateString(..., { timeZone: "UTC" })` everywhere. Cheapest, and automatically
   consistent with every existing stored key and with the new coach picker. Downside: in the
   evening the strip's "today" chip shows tomorrow's number — internally consistent, but it can
   disagree with the device's own clock.
2. **All-local**: derive the ISO key from local components (`getFullYear`/`getMonth`/`getDate`)
   instead of `toISOString()`. Matches what the user's device calls "today", which is what a
   meal planner arguably should mean. **But** `formatDateISO`/`toDateString` is shared and used
   by other callers, so changing it in place is a much wider blast radius — check every caller
   first (`grep -rn "formatDateISO\|toDateString" client/ server/ shared/`), and consider a
   separate local-basis helper rather than mutating the shared one. Existing rows were written
   on the UTC basis, so a switch changes which day historical items appear on.

Option 1 is the smaller, safer change and keeps the planner consistent with the coach picker
shipped in the same area. Option 2 is arguably more correct for a meal planner. **This is a
product call, not just a technical one** — decide deliberately and record the reasoning.

Related precedent already in the tree: `client/components/coach/plan-slot-picker-utils.ts`'s
`buildPlanSlotDays` docblock explains the failure mode and why it derives everything from one
basis. Read it before starting.

## Scope Contract

- **Mechanisms to use:** the existing `formatDateISO` helper and the existing `DateStripItem` /
  `weekDates` code — no new date library, no migration.
- **Files in scope:** `client/screens/meal-plan/MealPlanHomeScreen.tsx`,
  `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx`, and — only if option 2 is
  chosen after checking callers — `client/lib/format.ts` / `shared/lib/date.ts` plus a new
  co-located test.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The coach branch that surfaced this is independent and already fixed on its own side.

## Risks

- **Changing the shared `toDateString` affects unrelated callers** — including server-side
  consumers. Enumerate them before touching it; prefer a new helper.
- Existing `meal_plan_items` rows were written on the UTC basis. Switching to a local basis
  changes which strip day historical items render under, without any row changing. Users may
  read that as data moving. Consider whether that is acceptable before choosing option 2.
- A test that does not pin `TZ` will pass in CI (UTC) while the bug remains on real devices —
  this is exactly how the defect survived this long.

## Updates

### 2026-08-30

- Filed after the user authorised it. Surfaced during the coach "Add to Plan" branch
  (`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md`), where the
  same mixed-basis bug was caught in new code before it shipped; the pre-existing planner
  instance was deliberately left out of that branch's scope.
- Severity assessed **high**: it writes the wrong `plannedDate`, not merely a wrong label, and
  it affects every user west of UTC every evening.
