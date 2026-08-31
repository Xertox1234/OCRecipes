---
title: "The confirmed-meal set is UTC-bucketed while the totals beside it are tz-bucketed, and parseQueryDate accepts formats whose round-trip breaks by a day"
status: backlog
priority: medium
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [deferred, api, architecture, meal-plan, timezone]
github_issue:
---

# Two medium day-bucketing gaps on /api/daily-summary

> **Read this first.** A **High**-severity defect lives in the same four lines of code
> (`parseQueryDate` → `getDayBounds` resolves a requested date to the _previous_ local day for
> every UTC-negative user, all day). It is deliberately **not** filed here — per CLAUDE.md a
> High finding is surfaced to the user for a decision rather than auto-filed. Do not start this
> todo without checking whether that decision has been made, because the natural fix is one
> change to the same call path and splitting it would mean touching these lines twice.

## Summary

Two medium-severity gaps found while reviewing the P1 local-date-basis branch
(`todos/archive/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md`).
Both are pre-existing and neither is caused by that branch.

1. **`/api/daily-summary` mixes two day-bucketing bases in a single response.** `tz` is parsed at
   `server/routes/nutrition.ts:714` and threaded into `getDailySummary` but **not** into
   `getConfirmedMealPlanItemIds`, which falls back to `getDayBounds`'s `tz = "UTC"` default
   (`server/storage/helpers.ts:72`).
2. **`parseQueryDate` has no format guard**, so a non-ISO date string gets V8's local-time parse
   and the round-trip breaks by a day.

## Background

### 1. Consumed totals and the confirmed set disagree at the day edges

```ts
// server/routes/nutrition.ts:716-719
const [summary, confirmedIds] = await Promise.all([
  storage.getDailySummary(req.userId, date, tz), // tz-aware
  storage.getConfirmedMealPlanItemIds(req.userId, date), // NOT tz-aware
]);
```

`confirmedIds` becomes `excludeIds` in `server/storage/meal-plan-analytics.ts:43-52` and is also
returned as `confirmedMealPlanItemIds`, which `MealPlanHomeScreen` uses to render the confirmed
checkmark. So a meal logged near a day edge can be counted in `totalCalories` **and**
`plannedCalories` at once while showing as unconfirmed; re-confirming hits the same UTC-bounds
miss at `server/routes/meal-plan.ts:557` and fails on the
`daily_logs_unique_meal_plan_confirm` constraint. An un-confirmable meal.

The P1 branch **improves** this incidentally but does not close it. Measured, as hours out of 24
where the confirmed-set lookup matches the user's real local day:

| TZ                    | offset | before P1 | after P1 |
| --------------------- | ------ | --------- | -------- |
| `UTC`                 | 0      | 24 / 24   | 24 / 24  |
| `Europe/Berlin`       | +2     | 2 / 24    | 22 / 24  |
| `Pacific/Auckland`    | +12    | 12 / 24   | 12 / 24  |
| `America/Los_Angeles` | −7     | 17 / 24   | 17 / 24  |
| `America/New_York`    | −4     | 20 / 24   | 20 / 24  |

Note `Pacific/Auckland`: the count is unchanged but it is a **different twelve hours** — mornings
matched before, afternoons match now. Individual Auckland users therefore saw behaviour change in
both directions across the P1 upgrade even though the aggregate did not move.

### 2. `parseQueryDate` accepts anything `new Date()` parses

```ts
// server/routes/_helpers.ts:144-149
export function parseQueryDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return date;
}
```

For a well-formed `YYYY-MM-DD` the round-trip is exact and TZ-independent (ES parses date-only
forms as UTC). But `?date=2026/09/02` or `?date=Sep 2, 2026` takes V8's **local-time** parse, and
`toDateString` then returns a different day. `/api/meal-plan` guards strictly via
`validateMealPlanDateRange` (`server/routes/meal-plan.ts:100+`); `/api/daily-summary` and
`/api/daily-budget` (`server/routes/goals.ts:143`) do not.

Latent rather than live: the Node **process** TZ is not pinned anywhere (`server/db.ts:19` pins
the Postgres session and `server/index.ts:375` sets a formatting timezone — neither sets
`process.env.TZ`), and Railway's default is UTC, where local and UTC parses coincide. It becomes
live the moment the process runs anywhere else.

## Acceptance Criteria

- [ ] `getConfirmedMealPlanItemIds` accepts a `tz` and passes it to `getDayBounds`; the callers at
      `server/routes/nutrition.ts:718` and `server/routes/meal-plan.ts:557` pass the request's
      parsed timezone.
- [ ] A test asserts that, for one **UTC-positive** and one **UTC-negative** zone, the confirmed
      set and `getDailySummary`'s totals bucket the _same_ local day. CI runs UTC, where the two
      bases agree, so a UTC-only test does not close this.
- [ ] `parseQueryDate` rejects anything that is not `/^\d{4}-\d{2}-\d{2}$/` (returning `undefined`,
      preserving the existing `?? new Date()` fallback shape), **or** `process.env.TZ = "UTC"` is
      set at the top of `server/index.ts` — state which was chosen and why.
- [ ] No behaviour change for well-formed ISO input in UTC, so existing tests stay green
      unmodified.

## Implementation Notes

`getDayBounds(date, tz)` already exists and is DST-correct. Item 1 is threading an argument
through two call sites; the work is in the test, not the change.

For item 2, prefer the format guard over pinning `process.env.TZ`: the guard fixes the actual
contract violation (an endpoint accepting a format it cannot round-trip), while pinning the
process TZ only hides it on hosts that happen to run UTC. Doing both is fine.

## Scope Contract

- **Mechanisms to use:** the existing `getDayBounds` / `parseTimezone` helpers — no new date
  library, no migration.
- **Files in scope:** `server/storage/meal-plan-items.ts`, `server/routes/nutrition.ts`,
  `server/routes/meal-plan.ts`, `server/routes/_helpers.ts`, and their co-located tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Check the High-severity finding called out at the top of this file first — the natural fix
  touches the same call path.

## Risks

- Changing the confirmed-set bucketing changes which meals read as confirmed for users near a day
  edge. That is the point, but it is user-visible.
- A test that does not pin a non-UTC `TZ` passes in CI while both defects stay live.

## Updates

### 2026-08-31

- Filed from the review sweep of the P1 local-date-basis branch, with the per-zone match rates
  measured against the real `getDayBounds` rather than a reimplementation. Two reviewers
  independently reported the first item; the second came from the adversarial server-side check.
