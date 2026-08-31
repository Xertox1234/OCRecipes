---
title: "The plan-slot picker's timezone regression guards are silent in CI and on the dev machine — they only fire in a UTC-positive zone nobody runs"
status: backlog
priority: medium
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [testing, timezone, coach, meal-plan]
github_issue:
---

# The tests that would catch the date-basis bug never actually run

## Summary

`client/components/coach/__tests__/plan-slot-picker-utils.test.ts` has a discriminating test that
would catch a revert of `buildPlanSlotDays` to a UTC date basis — but it only discriminates in a
**UTC-positive** timezone. CI runs in UTC and this dev machine is `America/Edmonton` (UTC-6), so
the guard is silent in both. It has fired exactly once ever: in a hand-run
`TZ=Europe/Berlin` mutation check.

## Background

Filed 2026-08-31 by the final reviewer of PR #885 (the coach "Add to Plan" branch,
`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md`). It did not hold
that branch — the behaviour is correct, only its regression guard is not durable.

The bug the guard exists to catch: `buildPlanSlotDays` originally derived the chip label and the
`plannedDate` key from the **UTC** calendar day of a raw `new Date()`, while
`MealPlanHomeScreen` keys rows from `formatDateISO(local midnight)`
(`MealPlanHomeScreen.tsx:538-542`, `:572`). For UTC-positive users the planner keys
`local_day - 1` while the picker wrote `local_day`, so every coach-added item landed one planner
chip later — 100% of the time in Berlin and Auckland. It is fixed; this todo is about keeping it
fixed.

**Why the guards are silent.** The discriminator asserts
`days[0].iso === formatDateISO(<local midnight of now>)`. Under **UTC**, local midnight and the raw
instant fall on the same UTC day, so the old UTC-based implementation satisfies it identically.
The same holds for every **UTC-negative** zone, and for the two chip-label cross-checks in
`PlanSlotPickerSheet.test.tsx` and `CoachChat.branches.test.tsx`, which re-derive a weekday from
`iso`.

Confirmed: no `TZ` is set in `vitest.config.ts`, in `test/setup.ts`, or in any
`.github/workflows/*.yml`; GitHub-hosted runners default to UTC.

The originating branch's own P1 sibling todo
(`todos/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md`) names this
exact trap in its Risks section — _"A test that does not pin a UTC-positive `TZ` will pass in CI
(UTC) while the bug remains on real devices"_ — and then leaves its own guard sitting in it.

## Acceptance Criteria

- [ ] Reverting `buildPlanSlotDays` to the UTC basis (`setUTCDate`/`getUTCDate`, plus
      `timeZone: "UTC"` on the `toLocaleDateString` calls) makes at least one test fail **in CI**,
      not merely under a hand-set `TZ`.
- [ ] The chosen mechanism does not change the timezone of unrelated date-sensitive tests
      elsewhere in the repo. Verify by running the full suite before and after and comparing.
- [ ] Whatever mechanism is used is documented where the next contributor will hit it — a comment
      at the top of the affected test file naming why the timezone is pinned.
- [ ] The mutation check is actually performed and its output recorded: revert the basis, observe
      the failure in the pinned configuration, restore.

## Implementation Notes

The final reviewer deliberately declined to prescribe a remedy, because each candidate needs its
own verification run. Both known options have a real catch:

1. **Module-scope `process.env.TZ = "Europe/Berlin"` in the test file.** Cheap, and scoped to one
   file — but ESM `import` statements hoist _above_ module-scope statements, so this only works if
   nothing in that file's import graph constructs a `Date` at import time. That is true today and
   could silently stop being true. If you take this route, add a test that asserts the process
   timezone is what you expect, so the mechanism itself is guarded.
2. **Vitest `test.env` / a per-project config.** More robust, but `test.env` is global — it would
   move every date-sensitive test in the repo into a UTC-positive zone, which is a much wider
   change than this todo wants. A separate vitest project scoped to the coach date tests avoids
   that at the cost of config complexity.

A third option worth considering: make the assertion timezone-independent instead of pinning a
timezone — e.g. have the test compute the planner's key using the planner's _own_ derivation
(`new Date()` → `setHours(0,0,0,0)` → `formatDateISO`) and assert equality, then ALSO assert
something that can only hold on a local basis, such as `days[0].dayOfMonth === new Date().getDate()`.
That second assertion fails under a UTC basis in any zone where the current UTC day differs from
the local day — which is ~31% of hours in `America/Los_Angeles` but **0%** in UTC, so on its own
it still would not fire in CI. Timezone pinning is probably unavoidable; note this so the next
person does not rediscover it.

Note the one guard that IS durable and should be kept: `formatPlanSaveSuccess`'s "does no date
parsing of its own" test is timezone-independent and pins the toast-weekday regression class in CI.

## Scope Contract

- **Mechanisms to use:** vitest configuration and the existing test files — no production-code
  changes; `buildPlanSlotDays` is correct as it stands.
- **Files in scope:** `client/components/coach/__tests__/plan-slot-picker-utils.test.ts`,
  `client/components/coach/__tests__/PlanSlotPickerSheet.test.tsx`, and `vitest.config.ts` only if
  a config-level mechanism is chosen.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The behaviour under test is already correct on `main` once PR #885 merges.

## Risks

- **A global `TZ` change would move every date-sensitive test in the repo.** The suite currently
  passes under UTC; some tests may be implicitly relying on that. Run the whole suite under the
  candidate configuration before committing to it.
- Pinning a _fixed_ zone means DST transitions in that zone become part of the test environment.
  `Europe/Berlin` is a reasonable choice (UTC+1/+2, transitions at 02:00 local, so local midnight
  always exists). Avoid zones whose DST transition is at 00:00 local — `America/Santiago`,
  `Asia/Beirut` — where local midnight does not exist on the transition day.

## Updates

### 2026-08-31

- Filed from the final review of PR #885. Behaviour is correct; only the regression guard is not
  durable. Explicitly judged not to block that branch.
