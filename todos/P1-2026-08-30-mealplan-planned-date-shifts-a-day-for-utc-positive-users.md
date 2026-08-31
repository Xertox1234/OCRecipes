---
title: "MealPlanHomeScreen is internally consistent but keys every `plannedDate` one calendar day early for every UTC-positive-offset user"
status: backlog
priority: high
created: 2026-08-30
updated: 2026-08-30
assignee:
labels: [react-native, meal-plan, data-integrity, timezone]
github_issue:
---

# The planner agrees with itself, and both readings are one day early for half the planet

## Summary

`MealPlanHomeScreen` normalises "today" to **local midnight** once
(`d.setHours(0, 0, 0, 0)` at `:538-542`) and derives everything — the strip's day-of-month,
weekday initial, spoken a11y label, AND the `plannedDate` read/write key — from that same
`Date`. So within the app the label and the key always agree with each other; this is not a
mixed-basis bug. The key derivation (`formatDate` → `toISOString().split("T")[0]`, i.e. UTC)
is the one place that reinterprets the local-midnight instant in UTC. For any UTC-**positive**
offset (Europe, Africa, most of Asia and Oceania — Berlin, Auckland, Tokyo, Lagos), local
midnight falls on the _previous_ UTC calendar day, so every `plannedDate` the planner reads or
writes is **one day earlier** than the day its own chip is labelled with — constantly, not just
in the evening, and not only in the Americas (the Americas are UTC-negative and unaffected).

## Background

Found on 2026-08-30 while implementing
`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md` (the coach
"Add to Plan" branch). **This todo's original version was itself wrong** — it claimed the
planner mixed a local basis for display with a UTC basis for the key, and that the symptom was
an evening-only, Americas-only "item moves to tomorrow" effect. Neither is accurate; both claims
were corrected during that branch's final review after re-reading
`MealPlanHomeScreen.tsx:538-542` directly. The real, narrower defect is recorded below.

The new coach slot picker (`client/components/coach/plan-slot-picker-utils.ts`) was fixed on
that branch to use this planner's own basis (local-midnight-normalised input, then
`formatDateISO`/`toISOString()` to derive the key) — so the picker now agrees with the planner
on which day an item lands. **That fix does not close this todo.** It only ensures the two
writers of `planned_date` are wrong together instead of wrong differently; the underlying
UTC-positive skew described below is still live in both places. This branch adds the coach
picker as a **second consumer** carrying the same skew, which raises the cost of leaving it open.

Verified against `f73ab7aa`:

| Where                                                                                      | Derived from                                            | Line                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| `today`/`selectedDate` — `new Date(); d.setHours(0, 0, 0, 0)`                              | the shared local-midnight input for everything below    | `MealPlanHomeScreen.tsx:538-542` |
| `weekStart.setDate(weekStart.getDate() - weekStart.getDay())`, then `addDays`              | local components (`setDate`/`getDate`), from the above  | `:606-611`                       |
| `DateStripItem` weekday initial — `date.toLocaleDateString("en-US", { weekday: "short" })` | local components                                        | `:149-150`                       |
| `DateStripItem` day number — `date.getDate()`                                              | local components                                        | `:152`                           |
| `DateStripItem` spoken a11y label — `date.toLocaleDateString(...)`                         | local components                                        | `:166`                           |
| `selectedDateStr = formatDate(selectedDate)` — the add/read key                            | **`toISOString()` of the local-midnight instant above** | `:572`                           |
| `startDate` / `endDate` for the items query                                                | same `toISOString()` conversion                         | `:613-614`                       |

`formatDate` is `formatDateISO` from `@/lib/format`, a re-export of `toDateString` in
`shared/lib/date.ts:2-4`, which is `date.toISOString().split("T")[0]`. Every display row above
reads local components of the _same_ `Date` object the key row converts to UTC — the display
rows are correct and mutually consistent; only the UTC conversion applied to derive the stored
key introduces the skew, and only for a positive offset.

### The user-visible symptom (corrected)

In `Europe/Berlin` (UTC+2 in summer), at any time of day, local midnight for "today" — say
September 2 — is `2026-09-01T22:00:00Z`. `selectedDateStr` and every add/read key computed from
it is `"2026-09-01"`, while the strip's own chip is labelled, and highlighted as selected, for
September 2. So:

1. A meal added under the chip labelled "Sep 2" is written with `plannedDate = "2026-09-01"`.
2. It does **not** "move" the next morning (the original claim was wrong on this point) — it is
   filed one calendar day back from what the chip showed, permanently, for as long as the device
   stays in this offset. Reopening the app later still shows it under "Sep 1", not "Sep 2".
3. The 7-day fetch window (`startDate`/`endDate`) is shifted the same one day early, so the strip's
   own last displayed day is never covered by the query it just issued.

This affects every user whose device has a UTC-**positive** local offset — all day, every day —
not an evening-only window and not the Americas (UTC-negative offsets keep local midnight on the
same UTC calendar day, so their key already matches their label).

## Acceptance Criteria

- [ ] The `plannedDate` a chip labelled "Sep 2" reads and writes is the same calendar day the
      chip's own day-of-month, weekday, and a11y label show — for a UTC-positive offset, not just
      in UTC or a UTC-negative one.
- [ ] A test pins this with a fixed UTC-**positive** timezone (e.g. `TZ=Europe/Berlin` or
      `TZ=Pacific/Auckland`) at an arbitrary time of day — the defect is not time-of-day dependent,
      so the test does not need to target a specific hour. A test that only passes in UTC or a
      UTC-negative zone does not close this.
- [ ] The 7-day fetch window (`startDate`/`endDate`, `:613-614`) covers exactly the seven days
      the strip renders, for the same UTC-positive case.
- [ ] Decide and record which basis wins — see Implementation Notes; do not leave the two mixed.
- [ ] The fix also covers `client/components/coach/plan-slot-picker-utils.ts` — it currently
      matches this planner's flawed basis deliberately (see Background); closing this todo without
      updating it reintroduces the exact mismatch the coach branch fixed.
- [ ] No existing meal-plan item's stored `plannedDate` is rewritten by this change. This is a
      display/derivation fix, not a data migration.

## Implementation Notes

**The basis decision is the whole task; the edit is small.** Two coherent options:

1. **All-UTC**: use `setUTCDate`/`getUTCDate` and `toLocaleDateString(..., { timeZone: "UTC" })`
   for the DISPLAY fields too, so the chip's own label always matches the UTC day the key already
   uses. Cheapest, and automatically consistent with every existing stored key. Downside: for a
   UTC-positive user the "today" chip can show a day the device's own clock has not reached yet
   (and vice versa for UTC-negative) — internally consistent, but can disagree with the device.
2. **All-local**: derive the ISO key from local components (`getFullYear`/`getMonth`/`getDate`)
   instead of `toISOString()`, so the stored key always matches what the device calls "today".
   Matches user expectation for a meal planner. **But** `formatDateISO`/`toDateString` is shared
   and used by other callers, so changing it in place is a much wider blast radius — check every
   caller first (`grep -rn "formatDateISO\|toDateString" client/ server/ shared/`), and consider a
   separate local-basis helper rather than mutating the shared one. Existing rows were written on
   the UTC-of-local-midnight basis, so a switch changes which day historical items appear under
   for every UTC-positive user (their items shift forward one day to match their real local date).

Note what the coach branch's fix was, precisely, so it is not mistaken for either option above:
it made `buildPlanSlotDays` normalise to local midnight (matching this planner's _input_) and
still apply `formatDateISO`/`toISOString()` to derive `iso` (matching this planner's _key
derivation_) — i.e. it deliberately reproduced this planner's existing basis rather than fixing
it, because the picker's job was to agree with the other writer of the column, not correct it.
Whichever option is chosen here must be applied to `plan-slot-picker-utils.ts` as well, or the
picker silently drifts back out of agreement with the planner it was fixed to match.

Option 1 is the smaller, safer change. Option 2 is arguably more correct for a meal planner but
touches historical data's apparent day and a shared helper. **This is a product call, not just a
technical one** — decide deliberately and record the reasoning.

## Scope Contract

- **Mechanisms to use:** the existing `formatDateISO` helper and the existing `DateStripItem` /
  `weekDates` code — no new date library, no migration.
- **Files in scope:** `client/screens/meal-plan/MealPlanHomeScreen.tsx`,
  `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx`,
  `client/components/coach/plan-slot-picker-utils.ts`,
  `client/components/coach/__tests__/plan-slot-picker-utils.test.ts`, and — only if option 2 is
  chosen after checking callers — `client/lib/format.ts` / `shared/lib/date.ts` plus a new
  co-located test.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The coach branch that surfaced this has already shipped its own narrower fix (matching
  this planner's basis, not correcting it) independently of this todo.

## Risks

- **Changing the shared `toDateString` affects unrelated callers** — including server-side
  consumers. Enumerate them before touching it; prefer a new helper.
- Existing `meal_plan_items` rows were written on the UTC-of-local-midnight basis. Switching to a
  local basis changes which strip day historical items render under for UTC-positive users,
  without any row changing. Users may read that as data moving. Consider whether that is
  acceptable before choosing option 2.
- A test that does not pin a UTC-**positive** `TZ` will pass in CI (UTC) while the bug remains on
  real devices for roughly half the world's timezones — this is exactly how the defect survived
  this long.

## Updates

### 2026-08-30

- Filed after the user authorised it. Surfaced during the coach "Add to Plan" branch
  (`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md`), where the
  same underlying skew was caught in new code before it shipped; the pre-existing planner
  instance was deliberately left out of that branch's scope.
- **Corrected the same day**, during that branch's final-review fix wave: the original filing
  claimed a local-vs-UTC mixed basis and an evening-only, Americas-only symptom. Both were wrong
  — the planner is internally consistent, and the real defect is a constant one-day-early skew
  for UTC-**positive** offsets only. Renamed from
  `P1-2026-08-30-mealplan-date-strip-mixes-local-display-with-utc-keys.md` to match.
- Severity kept **high**: it still writes the wrong `plannedDate`, not merely a wrong label, and
  the coach picker now gives this same skew a second consumer, raising the cost of leaving it open.
