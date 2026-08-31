---
title: "Two surfaces writing the same date column agreed on the helper and disagreed on its input — one normalised to local midnight, the other did not"
track: bug
category: logic-errors
tags: [react-native, client-state, testing, timezone, date, data-integrity, meal-plan, silent-failure]
module: client
applies_to: [client/components/coach/**/*.ts, client/screens/meal-plan/**/*.tsx, shared/lib/date.ts]
symptoms: ["An item saved from one screen appears under a different day on another screen", "A date bug that reproduces for users east of UTC and never for users west of it (or the reverse)", "Two features call the same date-formatting helper and still produce different keys", "A picker's first chip is tomorrow for part of the day", "Tests pass in CI and the bug is reported from a real device"]
created: '2026-08-31'
severity: high
---

# Two surfaces writing the same date column agreed on the helper and disagreed on its input

## Problem

`formatDateISO` (`shared/lib/date.ts` → `toDateString`) is `date.toISOString().split("T")[0]` —
it returns the **UTC** calendar day of whatever `Date` it is handed. That makes it a pure
function of its input, and it makes the *input's normalisation* the real contract.

Two features wrote the same `meal_plan_items.planned_date` column through that one helper:

- `MealPlanHomeScreen` normalises first — `const d = new Date(); d.setHours(0,0,0,0)` — so its
  key is the UTC day **of local midnight**.
- A new coach slot picker passed a raw `new Date()` and advanced it with `setUTCDate`, so its
  key was the UTC day **of the current instant**.

Both "used `formatDateISO`". The shared helper name made them look aligned in review. They are
not the same basis, and the divergence is invisible in the half of the world where the two
coincide.

## Symptoms

- For a **UTC-negative** offset (the Americas) local midnight maps to the same UTC date, so the
  two keys agree and everything looks correct.
- For a **UTC-positive** offset (Berlin, Auckland) local midnight maps to the *previous* UTC
  date. The planner keys `local_day - 1` while the picker wrote `local_day`, so an item added
  from the chip labelled "Wednesday, September 2" appeared in the planner under **Thursday
  September 3**. Measured by sweeping all 24 local hours: **22/24 hours in `Europe/Berlin`,
  12/24 in `Pacific/Auckland`** — a large fraction of every day for a whole user population,
  not an edge case.
- For a **UTC-negative** offset the label and the key shifted *together*, so an item did land
  under the chip it was tapped from — but that chip was ahead of the user's actual today for
  7/24 hours in `America/Los_Angeles`, during which the picker's first chip was *tomorrow* and
  today could not be selected at all.

> Two symptoms, two populations, and they need separate measurement. A sweep asking "does the
> tapped chip's label land on the planner chip with that label" scores every UTC-negative zone at
> **zero** — for a *negative* offset, local midnight of day X still falls on UTC day X (it is only
> a UTC-**positive** offset that pushes local midnight back onto UTC day X−1, which is the whole
> Root Cause above), so whatever key the picker writes the planner labels correctly. A sweep asking "does the written
> key match the planner's key for *today*" scores the same zones at 25-29% (Edmonton 6/24,
> Los Angeles 7/24), which is the separate "today is briefly unselectable" defect. Both are real;
> neither alone describes the bug, and quoting one number for both is how "100%" got written.

## Root Cause

Two distinct failures, one after the other, worth separating because the first fix caused the
second:

**1. Mixed basis inside one component.** The original picker took the day number from local
`getDate()` while its `iso` came from `formatDateISO` (UTC). The chip could read "Sat 30" while
writing `2026-08-31`. Label and value disagreed.

**2. Right diagnosis, wrong basis.** The fix made every field derive from one basis — correctly
identifying that mixing them was the bug — and chose **UTC** for the shared basis. That made the
component internally consistent and silently misaligned it with the other writer of the same
column.

> **Internal consistency is not cross-surface consistency.** Verifying that a component's label
> and its persisted value agree with *each other* proves nothing about whether either agrees with
> the other producer of that column. Both checks are necessary; only the first is local, which is
> why only the first tends to get done.

## Solution

Derive every field from the **same normalised instant that the other writer uses**, then let the
shared helper do its (UTC) job:

```ts
export function buildPlanSlotDays(from: Date, count = 7): PlanSlotDay[] {
  const days: PlanSlotDay[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);      // the basis, matching MealPlanHomeScreen
    d.setDate(d.getDate() + i);  // local accessors throughout — never setUTCDate
    days.push({
      iso: formatDateISO(d),     // correct ONCE d is a local midnight
      dayOfMonth: d.getDate(),
      weekday: d.toLocaleDateString("en-US", { weekday: "long" }), // no timeZone override
    });
  }
  return days;
}
```

Re-derive `d` from `from` every iteration rather than mutating one `Date` across the loop, so
nothing accumulates.

**Carry the label, never re-derive it.** A follow-on toast reproduced the same bug one layer up
by parsing the weekday back out of the `plannedDate` ISO string. Thread the value the user
actually tapped through the callback instead, and keep the formatter free of date handling:

```ts
// the formatter does no date work at all — it cannot reintroduce a basis
export const formatPlanSaveSuccess = (dayLabel: string, mealType: MealType) =>
  `Added to ${dayLabel} ${MEAL_LABELS[mealType]}`;
```

That version is testable without a timezone, which matters — see Prevention.

## Prevention

**Find the other writers before choosing a basis.** The question is never "is this component
self-consistent", it is "what else writes this column, and how does it derive its key". One
`grep` for the column name or the helper answers it.

**A timezone-sensitive test that does not pin `TZ` never runs.** This is the trap that let the
original defect survive, and it caught the *fix's own regression guard* too:

- The natural assertion — "the picker's `iso` equals what the planner computes for this instant"
  — is satisfied by **both** bases under UTC, because local midnight and the raw instant fall on
  the same UTC day there. **UTC is the unique zone with that property.**
- CI runs UTC (no `TZ` in `vitest.config.ts`, `test/setup.ts`, or the workflows; GitHub-hosted
  runners default to UTC), so the guard is silent in the one environment that runs unattended.

Pin **any non-UTC zone** for that test file — the offset's *sign* is irrelevant, despite how
naturally "the bug is a UTC-positive bug, so the test needs a UTC-positive zone" reads. Against
the real fixture (23:00 local), `America/Edmonton`, `America/Los_Angeles`, `Europe/Berlin` and
`Pacific/Auckland` all discriminate; only UTC does not. Getting this backwards costs a future
reviewer a rejected-but-correct `America/Denver` pin, which is why it is spelled out here.

Then verify the guard by mutation: revert the basis, watch the test fail **in the configuration
CI actually uses**, restore. A guard that has only ever failed under a hand-set `TZ` is not a
guard.

Anchor fixtures at an instant where the bases *differ* (e.g. 23:00 UTC in a UTC-positive zone).
A fixture at 12:00 UTC exercises nothing no matter which `TZ` you run it under.

**Watch the zones where local midnight does not exist.** `America/Santiago` and `Asia/Beirut`
transition DST at 00:00 local, so `setHours(0,0,0,0)` lands on 01:00. That is fine here — the
hour offset does not cross a UTC day boundary at those offsets — but it is worth checking rather
than assuming when the basis is load-bearing.

## Related Files

- `client/components/coach/plan-slot-picker-utils.ts` — `buildPlanSlotDays`, with a docblock that
  states the basis and forbids reverting to UTC accessors
- `client/screens/meal-plan/MealPlanHomeScreen.tsx:538-542` — the `setHours(0,0,0,0)` normalisation
  that defines the column's de-facto contract; `:572` and `:613-614` are the reads and writes
- `shared/lib/date.ts` — `toDateString`, the UTC-returning helper both callers share
- `client/components/coach/coach-chat-utils.ts` — `formatPlanSaveSuccess`, kept free of date logic
- `todos/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md` — the open
  product decision about what the column *should* store
- `todos/P2-2026-08-31-plan-slot-timezone-guards-never-run-in-ci.md` — the guard-durability gap

## See Also

- [Timezone-aware day boundaries using Intl.DateTimeFormat](../conventions/timezone-aware-day-boundaries-intl-2026-05-31.md) — the general technique for day boundaries when a true local basis is required
- [Dropping a timezone-local dedup pre-check for a UTC-day unique index](../conventions/tz-local-dedup-to-utc-day-index-safe-only-once-per-day-2026-06-26.md) — the same local-vs-UTC-day mismatch expressed as a uniqueness constraint
- [PostgreSQL session timezone + Drizzle UTC mismatch](postgres-session-timezone-drizzle-utc-mismatch-2026-05-13.md) — the same class one layer down, at the DB session boundary
- [A test comment must claim only what its own harness can observe](../code-quality/a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — related discipline for the guard half of this
