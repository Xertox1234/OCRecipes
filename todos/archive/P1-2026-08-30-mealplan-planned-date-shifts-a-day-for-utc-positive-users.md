---
title: "MealPlanHomeScreen is internally consistent but keys every `plannedDate` one calendar day early for every UTC-positive-offset user"
status: done
priority: high
created: 2026-08-30
updated: 2026-08-31
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
3. ~~The 7-day fetch window (`startDate`/`endDate`) is shifted the same one day early, so the
   strip's own last displayed day is never covered by the query it just issued.~~
   **Corrected 2026-08-31 — this was false.** The window bounds (`:613-614`) and the per-chip
   lookup key (`:572`, consumed by `dayItems[selectedDateStr]`) went through the _same_ helper, so
   both shifted together and coverage was never broken. This contradicted the Summary's own
   "internally consistent" finding. The window is pinned by a test now regardless, because nothing
   stopped a future edit to `:613-614` alone from breaking that agreement.

This affects every user whose device has a UTC-**positive** local offset — all day, every day —
not an evening-only window and not the Americas (UTC-negative offsets keep local midnight on the
same UTC calendar day, so their key already matches their label).

## Acceptance Criteria

- [x] The `plannedDate` a chip labelled "Sep 2" reads and writes is the same calendar day the
      chip's own day-of-month, weekday, and a11y label show — for a UTC-positive offset, not just
      in UTC or a UTC-negative one.
- [x] A test pins this with a fixed UTC-**positive** timezone (e.g. `TZ=Europe/Berlin` or
      `TZ=Pacific/Auckland`) at an arbitrary time of day — the defect is not time-of-day dependent,
      so the test does not need to target a specific hour. A test that only passes in UTC or a
      UTC-negative zone does not close this.
- [x] The 7-day fetch window (`startDate`/`endDate`, `:613-614`) covers exactly the seven days
      the strip renders, for the same UTC-positive case.
- [x] Decide and record which basis wins — see Implementation Notes; do not leave the two mixed.
- [x] The fix also covers `client/components/coach/plan-slot-picker-utils.ts` — it currently
      matches this planner's flawed basis deliberately (see Background); closing this todo without
      updating it reintroduces the exact mismatch the coach branch fixed.
- [x] No existing meal-plan item's stored `plannedDate` is rewritten by this change. This is a
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
   for every UTC-positive user. **Direction corrected 2026-08-31 — this line originally said
   "forward"; measured, it is BACKWARD.** A row stored as `2026-09-02` rendered under the chip
   labelled Sep 3 before the fix and under Sep 2 after it, identically in `Europe/Berlin` (+2),
   `Pacific/Auckland` (+12) and `Pacific/Kiritimati` (+14); `America/Los_Angeles` and `UTC` are
   unchanged.

   **Do not read that as "items now appear on the day the user tapped" — that holds only for NEW
   writes.** A pre-upgrade Berlin user who tapped the chip labelled _Wednesday, September 2_
   stored `2026-09-01`; after the change that row renders under _Tuesday, September 1_. Historical
   rows move one chip **earlier than the chip they were created from**, and they do not
   self-correct. The 7-day fetch window moves with them (`2026-08-29..09-04` →
   `2026-08-30..09-05`), so a legacy item filed on a week's first chip now falls outside that
   week's window and is reachable only from the previous week's strip. That is the accepted cost
   of shipping without a backfill.

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

### 2026-08-31 — RESOLVED

**Basis decided by the user: option 2, a true local basis** (AC 4). `planned_date` now means the
day the user's own device calls that day.

Implementation:

- Added `toLocalDateString` to `shared/lib/date.ts` **alongside** `toDateString` rather than
  changing it. `toDateString` has three server callers (`server/routes/micronutrients.ts`,
  `server/storage/batch.ts`, `server/storage/meal-plan-analytics.ts`) where "local" would mean the
  Railway host's timezone, not the user's — the doc comment says so explicitly.
- `MealPlanHomeScreen.tsx` and `client/components/coach/plan-slot-picker-utils.ts` moved together.
  The `formatDateISO as formatDate` alias was dropped: the root cause of this bug class is two
  writers agreeing on a helper _name_ while disagreeing on its basis, so the basis is now visible
  at every call site.
- Removed the `formatDateISO` re-export from `client/lib/format.ts`. Already deprecated, and after
  this change it had no callers but its own test — a generic-sounding name that silently returns a
  UTC day is exactly the footgun that produced this defect.

**Server impact was re-checked before any code was written, and it is why this was safe.** An
exhaustive grep of `plannedDate`/`planned_date` across `server/` shows the column is only ever
compared against strings the client supplied (`eq`/`gte`/`lte`), or against
`toDateString(parseQueryDate(clientString))`, which is an exact round-trip. **No server path
derives its own "today" and matches it against `planned_date`** — with one exception, filed
separately.

**Two adjacent live bugs are fixed as a side effect**, because the `date` param the planner sends
is now the user's real local day:

- `/api/daily-summary` and `/api/daily-budget` bucket daily logs via `getDailySummary(userId, date,
tz)`. A UTC-positive user's calorie ring was summarising the **previous** day's logged food for
  the day they were looking at. Measured on the planner's own `?date=` path
  (`useDailyBudget(selectedDateStr)` and the `/api/daily-summary?date=` fetch), as hours out of 24
  where the bucketed day equals the user's real local day:

  | TZ                    | before | after     |
  | --------------------- | ------ | --------- |
  | `UTC`                 | 24/24  | 24/24     |
  | `Europe/Berlin`       | 0/24   | **24/24** |
  | `Pacific/Auckland`    | 0/24   | **24/24** |
  | `America/Los_Angeles` | 0/24   | 0/24      |
  | `America/New_York`    | 0/24   | 0/24      |

  A complete fix for positive offsets, not a partial one — the key is derived from local midnight,
  so it is constant across the day rather than time-of-day dependent. **Do not confuse these with
  the `2/24 → 22/24` figures in
  `todos/P2-2026-08-31-daily-summary-day-bucketing-loses-the-users-tz.md`** — those belong to
  `getConfirmedMealPlanItemIds`, which is the UTC-bucketed sibling on the same response and is
  where Auckland is a 12/24 swap. An earlier draft of this bullet attached that function's numbers
  to this one, and additionally cited `DailyNutritionDetailScreen` / `useHistoryData`; both were
  wrong. Those screens send no `?date=` at all, so the server falls back to
  `getDayBounds(new Date(), tz)` — the user's true civil day, 24/24 in every zone, before and
  after.

  **This claim is UTC-POSITIVE ONLY, and the mirrored half stays live.** `parseQueryDate` turns
  `"2026-09-02"` into UTC midnight and `getDayBounds` then reads _that instant's_ civil date in
  the user's zone — for any negative offset that is the previous local day. Verified directly:
  `America/Los_Angeles` and `America/New_York` both resolve a requested `2026-09-02` to
  `2026-09-01` bounds, all 24 hours. Untouched by this change (the client string is byte-identical
  at negative offsets before and after) and deliberately **not** filed as a todo — it is High
  severity, so it was surfaced to the user for a decision per CLAUDE.md.

- Meal-plan confirm (`meal-plan.ts:559`) derives UTC day bounds from the item's stored
  `plannedDate` to find matching logs; those bounds now overlap the user's actual local day for
  most of it.

**No data migration** (AC 6): no row is rewritten. A backfill is not soundly computable anyway — no
row records the device offset it was written under, so a genuinely-Sep-1 item cannot be told apart
from a Sep-2 item that was filed a day early.

Guards, with the mutation checks actually run (failure counts per pinned zone):

| mutation                          | UTC | Berlin (+2) | Auckland (+12) | LA (−7) |
| --------------------------------- | --- | ----------- | -------------- | ------- |
| picker `iso` → `toDateString`     | 0   | 4           | 4              | 0       |
| picker reverted to full UTC basis | 0   | 1           | 2              | 1       |
| planner import → `toDateString`   | —   | 3           | —              | —       |

So the first shape is caught only at a positive offset while the second is caught at either sign —
which is why both signs stay in the picker's zone loop.

Timezone is pinned per-file via `process.env.TZ` in `beforeAll`, verified to take effect inside the
Vitest worker (Node 24) by a `getTimezoneOffset()` assertion in each block. **Note for the next
person:** `describe.each`/`it.each` tables are evaluated at **collection** time, before any hook
runs, so a `Date` fixture in the table is constructed in the host zone and then read back in the
pinned one — silently testing neither. Fixtures must be built inside the test body. This bit during
implementation; it is the same hoisting hazard the sibling P2 todo warns about, in a different form.

Left open deliberately:

- `todos/P2-2026-08-31-plan-slot-timezone-guards-never-run-in-ci.md` — this work satisfies its ACs
  1–4 for `plan-slot-picker-utils.test.ts`, but not for `PlanSlotPickerSheet.test.tsx`, and not its
  "re-derive empirically whether those are silent under UTC" criterion.
