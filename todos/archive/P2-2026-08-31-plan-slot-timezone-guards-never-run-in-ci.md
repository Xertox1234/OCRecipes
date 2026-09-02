---
title: "The plan-slot picker's date-basis regression guards are silent in CI, because UTC is the one timezone where both bases agree"
status: done
priority: medium
created: 2026-08-31
updated: 2026-09-02
assignee:
labels: [testing, timezone, coach, meal-plan]
github_issue:
---

# The tests that would catch the date-basis bug never run where it matters

## Summary

`client/components/coach/__tests__/plan-slot-picker-utils.test.ts` has a test that would catch a
revert of `buildPlanSlotDays` to a UTC date basis — but it cannot discriminate under **UTC**, and
CI runs UTC. The guard is therefore silent in the one environment that runs unattended.

## Background

Filed 2026-08-31 from the final review of PR #885 (the coach "Add to Plan" branch,
`todos/archive/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md`). It did not hold
that branch — the behaviour is correct, only its regression guard is not durable.

The bug the guard exists to catch: `buildPlanSlotDays` originally derived the chip label and the
`plannedDate` key from the **UTC** calendar day of a raw `new Date()`, while
`MealPlanHomeScreen` keys rows from `formatDateISO(local midnight)`
(`MealPlanHomeScreen.tsx:538-542`, `:572`). The two bases diverge, and items landed on the wrong
planner day. It is fixed; this todo is about keeping it fixed.

**Why the guard is silent — and the correction that matters.** The discriminator asserts
`days[0].iso === formatDateISO(<local midnight of now>)`. Under **UTC**, local midnight and the
instant fall on the same UTC day, so the old UTC-based implementation satisfies it identically.

**UTC is the _unique_ zone with that property.** An earlier draft of this todo claimed the guard
"only discriminates in a UTC-positive timezone" and that a `UTC-6` dev machine was equally
silent. Both were wrong. Measured against the test's real fixture (23:00 local on 2026-09-01):

| TZ                         | broken basis | fixed basis | guard      |
| -------------------------- | ------------ | ----------- | ---------- |
| `UTC`                      | 2026-09-01   | 2026-09-01  | **silent** |
| `America/Edmonton` (−6)    | 2026-09-02   | 2026-09-01  | fires      |
| `America/Los_Angeles` (−7) | 2026-09-02   | 2026-09-01  | fires      |
| `Europe/Berlin` (+2)       | 2026-09-01   | 2026-08-31  | fires      |
| `Pacific/Auckland` (+12)   | 2026-09-01   | 2026-08-31  | fires      |

So the constraint is simply **any nonzero offset**; the sign is irrelevant. Getting this backwards
is easy — "the bug hurt UTC-positive users, so the test needs a UTC-positive zone" reads
naturally and is false — and it would cost a future contributor a rejected-but-correct
`America/Denver` pin.

Confirmed separately: no `TZ` is set in `vitest.config.ts`, in `test/setup.ts`, or in any
`.github/workflows/*.yml`; GitHub-hosted runners default to UTC.

The sibling P1 todo
(`todos/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md`) names this
trap in its Risks section — _"A test that does not pin a `TZ` will pass in CI (UTC) while the bug
remains on real devices"_ — and then leaves its own guard sitting in it.

## Acceptance Criteria

- [x] Reverting `buildPlanSlotDays` to the UTC basis (`setUTCDate`/`getUTCDate`, plus
      `timeZone: "UTC"` on the `toLocaleDateString` calls) makes at least one test fail **in CI**,
      not merely under a hand-set `TZ`.
- [x] The chosen mechanism does not change the timezone of unrelated date-sensitive tests
      elsewhere in the repo. Verify by running the full suite before and after and comparing.
- [x] The mechanism is documented where the next contributor will hit it — a comment at the top
      of the affected test file naming why the timezone is pinned, and stating that **any**
      non-UTC zone works (so nobody "fixes" a valid negative-offset pin). **Satisfied as-written
      for `plan-slot-picker-utils.test.ts`** (its header already carries the measured per-shape
      table). **For `PlanSlotPickerSheet.test.tsx`, satisfied with a deliberate, documented
      divergence** — see the 2026-09-02 Update: the literal "any non-UTC zone works" sentence is
      false for that file's fixed-instant render test, so its comment states the protective
      inverse (positive-offset-specific by construction) instead.
- [x] The mutation check is actually performed and its output recorded: revert the basis, observe
      the failure in the pinned configuration, restore.
- [x] Re-derive empirically whether `PlanSlotPickerSheet.test.tsx` and
      `CoachChat.branches.test.tsx` are also silent under UTC before assuming it — the earlier
      draft asserted it without measurement, and the neighbouring reasoning in that draft was
      wrong in the same direction.

## Implementation Notes

The final reviewer deliberately declined to prescribe a remedy, because each candidate needs its
own verification run. Both known options have a real catch:

1. **Module-scope `process.env.TZ = "..."` in the test file.** Cheap, and scoped to one file —
   but ESM `import` statements hoist _above_ module-scope statements, so this only works if
   nothing in that file's import graph constructs a `Date` at import time. That is true today and
   could silently stop being true. If you take this route, add an assertion that the process
   timezone is what you expect, so the mechanism itself is guarded.
2. **Vitest `test.env` / a per-project config.** More robust, but `test.env` is global — it would
   move every date-sensitive test in the repo off UTC, a much wider change than this todo wants.
   A separate vitest project scoped to the coach date tests avoids that at the cost of config
   complexity.

Any nonzero-offset zone satisfies the requirement, so pick on secondary criteria — a zone whose
DST transition is **not** at 00:00 local keeps `setHours(0,0,0,0)` on a real midnight
(`Europe/Berlin` and `America/Denver` both qualify; `America/Santiago` and `Asia/Beirut` do not).

A tempting third option — make the assertion timezone-independent instead of pinning — does not
work on its own: an assertion like `days[0].dayOfMonth === new Date().getDate()` fails under a UTC
basis in any offset zone but is satisfied under UTC, which is exactly the environment that needs
covering. Timezone pinning is unavoidable here; noted so the next person does not rediscover it.

Keep the one guard that IS durable: `formatPlanSaveSuccess`'s "does no date parsing of its own"
test is timezone-independent and pins the toast-weekday regression class in CI.

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
- Pinning a fixed zone makes that zone's DST transitions part of the test environment. Avoid
  zones transitioning at 00:00 local, where local midnight does not exist on the transition day.

## Updates

### 2026-08-31

- Filed from the final review of PR #885. Behaviour is correct; only the regression guard is not
  durable. Explicitly judged not to block that branch.
- **Corrected the same day, before merge.** The first draft's premise — "only discriminates in a
  UTC-positive timezone", "the `UTC-6` dev machine is equally silent", "has fired exactly once
  ever" — was wrong on all three counts. A review of the codification commit caught it and the
  claim was re-measured; the table above is the verified result. The CI-blindness conclusion
  survives unchanged, but for a different reason than originally written.

### 2026-08-31 (later) — partially addressed, deliberately left open

The P1 local-date-basis work
(`todos/archive/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md`)
adopted option 1 from the Implementation Notes, in its safer hook-based form, and applied it to
`client/components/coach/__tests__/plan-slot-picker-utils.test.ts`:

- `process.env.TZ` is set in `beforeAll` rather than at module scope. This sidesteps the ESM
  hoisting caveat this todo raised — hooks run after the whole import graph is evaluated — and it
  is verified to take effect inside the Vitest worker (Node 24) by a `getTimezoneOffset()`
  assertion in each block, satisfying the "assert the mechanism itself" note.
- The file now loops over `UTC`, `Europe/Berlin`, `Pacific/Auckland`, `America/Los_Angeles`.
- The mutation check was run. Failure counts per zone: reverting only `iso` to `toDateString`
  gives `UTC 0 / Berlin 4 / Auckland 4 / LA 0`; reverting to a full UTC basis gives
  `UTC 0 / Berlin 1 / Auckland 2 / LA 1`.

**That second row refines this todo's central claim.** "Any nonzero offset discriminates, the sign
is irrelevant" holds for a full-UTC-basis revert, but NOT for the narrower revert of just the `iso`
derivation, which only a **positive** offset catches. Both signs are therefore kept in the loop
deliberately, and the reason is recorded in the test file — do not prune one as redundant.

**A new trap, found the hard way during that work and worth recording here:** `describe.each` /
`it.each` tables are evaluated at **collection** time, before any hook runs. A `Date` fixture
placed in the table is constructed in the host zone and then read back under the pinned zone,
silently testing neither basis. Fixtures must be built inside the test body. This is the same
hazard as the module-scope caveat above, in a form that is much harder to spot.

Still open, and the reason this todo is not archived:

- `client/components/coach/__tests__/PlanSlotPickerSheet.test.tsx` is untouched.
- AC 5 — empirically re-deriving whether `PlanSlotPickerSheet.test.tsx` and
  `CoachChat.branches.test.tsx` are silent under UTC — has not been done.
- AC 2 — confirming the mechanism does not perturb unrelated date-sensitive tests — was checked
  only across the 25 files related to that change (401 tests, all green), not the full suite.

### 2026-09-02 — RESOLVED

**Correction to the previous entry, found by verification, not assumption.** The bullet above
("verified to take effect... by a `getTimezoneOffset()` assertion in each block") was **false**
for this file — that pattern was applied to `MealPlanHomeScreen.test.tsx` and
`shared/lib/__tests__/date.test.ts`, but `plan-slot-picker-utils.test.ts` had no such assertion
(confirmed by grep before adding it: zero hits). The **pin itself** genuinely worked — the failure
counts below reproduce the previous entry's numbers exactly, which is only possible if the pin took
effect — only the claim about _how it had been verified_ was wrong. Flagging so the human record is
accurate: the sibling P1 archived todo
(`todos/archive/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md`,
Updates → 2026-08-31 RESOLVED) carries the identical sentence about this same file; it is left
uncorrected there since amending an archived todo outside this one's Scope Contract is out of
scope — surfaced to the user via the executor's report instead.

**Work done, closing all remaining ACs:**

- Added the missing "guards the mechanism" test to each zone block in
  `plan-slot-picker-utils.test.ts` (one `it` per `describe.each` entry), per the Solution section of
  `docs/solutions/logic-errors/an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md`.
  Re-measured with a clean per-zone JSON reporter (`TZ=UTC` host, deduped by `ancestorTitles` +
  `fullName`, not inferred from a raw FAIL-line count): `iso`-only revert to a UTC conversion —
  `UTC 0 / Berlin 4 / Auckland 4 / LA 0`; full-UTC-basis revert —
  `UTC 0 / Berlin 1 / Auckland 2 / LA 1`. Both match the previous entry's numbers exactly (AC 1, AC
  4 for this file).
  - **New trap found while adding the guard, not in either solution doc yet:** for the `UTC` zone's
    row, `-new Date(...).getTimezoneOffset()` is `-0`, not `0` — `toBe`'s `Object.is` treats `-0`
    and `0` as distinct, so the naive guard assertion **fails on correct code**
    (`expected -0 to be +0`). Fixed with `+ 0` to normalize (`-0 + 0 === 0` under IEEE 754). Neither
    in-repo precedent (`shared/lib/__tests__/date.test.ts`, `MealPlanHomeScreen.test.tsx`) hits this
    — both only ever pin nonzero-offset zones — so this file is the first to need it.
- Added a new `describe` block to `PlanSlotPickerSheet.test.tsx` (AC 5's "untouched" file, now
  addressed): a "guards the mechanism" test plus one discriminating test, pinning
  `process.env.TZ = "Europe/Berlin"` **and** faking the system clock
  (`vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`) at a fixed instant
  (`2026-09-01T22:30:00Z`). This mechanism is neither of the two the Implementation Notes
  enumerate (module-scope `process.env.TZ`, `test.env`) — necessarily so, because
  `PlanSlotPickerSheet.tsx` calls `new Date()` internally (lines ~76, ~93) with no injectable
  `from` seam, so neither enumerated mechanism can control it. In-repo precedent:
  `MealPlanHomeScreen.test.tsx:347-361` pairs the same two mechanisms for the same reason.
  Mutation-tested the new test itself (not just inferred): with the full-UTC-basis mutation
  applied and `TZ=UTC` on the host, the new discriminating test fails and every "guards the
  mechanism" assertion (old and new, across both files) still **passes** — correct, since those
  assert the harness pin, not the code under test.
- **AC 3 — the utils file's header comment already carries the accurate, measured form of the
  "why" (the per-shape table); the new `PlanSlotPickerSheet.test.tsx` block does NOT claim "any
  non-UTC zone works", because that sentence is false for a fixed-instant render test** — only an
  offset matching the pinned instant's sign discriminates there. Its comment states the protective
  inverse instead: this pin is positive-offset-specific by construction, and the negative-offset
  regression class stays covered by `plan-slot-picker-utils.test.ts`'s own `America/Los_Angeles`
  row. Recorded here as the Acceptance-Criteria/reality conflict Step 4 asks to flag rather than
  silently diverge from.
- **AC 5, measured (not assumed) for both remaining files**, at `TZ=UTC` _and_ `TZ=Europe/Berlin`,
  against both mutation shapes: `PlanSlotPickerSheet.test.tsx` (pre-existing tests only) and
  `CoachChat.branches.test.tsx` are **silent at every zone tried, not merely under UTC** — a
  stronger, structural result than "only silent in the one zone that hides the bug". Both files'
  date-basis assertions are shape-only (`plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)`)
  or self-referential (comparing a rendered chip's own label against a rendered toast/onConfirm
  value, both derived from the _same_ ambient `new Date()` call the code under test also uses) —
  neither form can ever observe the `iso` field's derivation basis, in any timezone. This is the
  "uncontrolled ambient input" pattern in a form distinct from the three already catalogued in that
  solution doc's Problem section (test-before-fix, clobbered probe loop, one-machine mutation
  count) — extended into that file rather than filed as a new one, per the codify dedup path.
  `CoachChat.branches.test.tsx` was **measured, not edited** — outside this todo's Scope Contract,
  and its current diff on `main` overlaps `PlanSlotPickerSheet.tsx`/`CoachChat.branches.test.tsx`
  with the unmerged sibling PR #900 (`P2-2026-08-30-coach-plan-slot-guard-survives-sheet-dismissal`,
  a different concern — sheet-dismissal survival, not date basis). Surfaced to the user via the
  executor's report so a possible follow-up todo for `CoachChat.branches.test.tsx` is a decision,
  not an auto-file.
- **AC 2, measured against the FULL suite** (not the 25-file subset the previous entry used):
  before this file's edits, `525` test files / `8351` tests, all passing; after, `525` files
  (unchanged) / `8357` tests (+6 — exactly the 4 new zone-guard tests in the utils file plus the 2
  new tests in the Sheet file), all passing, zero other file's result changed. `vitest.config.ts`
  uses `pool: "forks"`, so `process.env.TZ` mutation is process-local by construction; this is the
  empirical confirmation of that mechanism claim, not a substitute for it.

All acceptance criteria closed. No production code changed (`buildPlanSlotDays` is byte-identical
to `main`) — every mutation applied above was reverted before this commit.
