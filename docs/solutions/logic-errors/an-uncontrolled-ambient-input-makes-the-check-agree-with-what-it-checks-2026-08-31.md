---
title: "An uncontrolled ambient input makes the check agree with what it checks — the test cannot fail, the probe measures nothing, and the mutation count is your machine's"
track: bug
category: logic-errors
tags: [testing, harness, timezone, silent-failure, test-isolation, probes, evidence]
module: shared
applies_to: [server/services/__tests__/*.test.ts, server/routes/__tests__/*.test.ts, server/storage/__tests__/*.test.ts, server/lib/__tests__/*.test.ts, client/hooks/__tests__/*.test.ts, client/screens/**/__tests__/*.test.ts, client/screens/**/__tests__/*.test.tsx, client/components/**/__tests__/*.test.ts, client/components/**/__tests__/*.test.tsx, shared/lib/__tests__/*.test.ts]
symptoms: ["A newly written test passes BEFORE the fix it was written for", "A probe reports 'no difference' across several configurations that should differ", "A mutation check fails N tests locally and a different N in CI", "A guard is green on CI and red on a developer machine, or the reverse, with no code change", "Two independent things agree suspiciously well and nothing explains why", "The control row of a parameterised table fails, when by definition it should be a no-op"]
created: '2026-08-31'
severity: medium
last_updated: '2026-09-02'
---

# An uncontrolled ambient input makes the check agree with what it checks

## Problem

A check is only worth its result if the thing it checks can differ from it. When both read the
same **ambient** input — the host timezone, `process.env`, the wall clock, the current working
directory, a locale — they move together, and the check becomes a mirror. It reports agreement
because it cannot report anything else.

This has three faces, and they are the same bug. The first two are narrated from the work that
produced this file (PRs #889/#890/#892) rather than from a committed artifact — the *mechanisms*
are checkable in the repo, the episodes are not:

1. **A test that passes before the fix.** The buggy code read `new Date().getHours()` (the host
   zone); the test asserted an hour "in Los Angeles". On a machine near that zone the two agreed,
   so the test was green against code that was wrong.
2. **A probe that measures nothing.** A script sweeping four timezones set `process.env.TZ` in a
   loop at the top, clobbering the `TZ=…` the shell had supplied. All four "different" runs
   measured the same zone and printed a tidy table showing no difference anywhere.
3. **Evidence that is one machine's.** A mutation kill-count quoted as proof of a guard turned
   out to vary by host zone, so the number in the write-up was a property of the author's laptop
   rather than of the guard. The in-repo example is the table in
   `todos/archive/P2-2026-08-31-plan-slot-timezone-guards-never-run-in-ci.md` (Updates → 2026-08-31):
   the same mutation kills `UTC 0 / Berlin 4 / Auckland 4 / LA 0` for one revert shape and
   `UTC 0 / Berlin 1 / Auckland 2 / LA 1` for another. **Note the UTC column is 0 in both** —
   quote a count taken on a developer machine and you claim a guard that CI does not have.
4. **A check that builds its own expectation from the same ambient read the code under test
   uses.** Not a missing pin this time — a test whose *expected* value and the code's *actual*
   value are both derived from the same uncontrolled `new Date()` call, so they move together by
   construction and the test cannot discriminate a regression in either, in any timezone. Measured
   directly (`TZ=UTC` and `TZ=Europe/Berlin`, both known regression shapes of
   `buildPlanSlotDays` applied and reverted):
   `client/components/coach/__tests__/PlanSlotPickerSheet.test.tsx`'s pre-existing tests build
   their expected day (`buildPlanSlotDays(new Date())`, same file, line ~123) with the identical
   ambient call the rendered component makes internally — both sides drift together under a
   basis regression. `CoachChat.branches.test.tsx`'s "Add to Plan" flow test compares a rendered
   toast's day word against a `chipLabel` harvested from the same render, and asserts `plannedDate`
   only against a shape regex (`/^\d{4}-\d{2}-\d{2}$/`), never its value — neither check can ever
   observe which basis produced the date. Both were **silent at every zone tried, not merely
   under UTC** — a stronger, structural variant of the pattern: it isn't that CI's zone happens to
   hide the bug, it's that the check cannot see this class of bug at all. See face 1 above for the
   general form (test passes before the fix) — this is what makes it possible to pass *permanently*
   rather than just in one environment.

## Symptoms

- **The strongest tell is a test that passes when you expected red.** Treat that as a finding, not
  as luck. It is the only one of the three that no reviewer can see — the test is green, so it
  looks correct from every angle except the one where you know it should have failed.
- The **control** case of a parameterised sweep fails. If the row that is defined to change
  nothing behaves differently, the environment is the variable, not the code.
- A number that differs between two people running the same command.
- Expected and actual differ by exactly the host's offset from the value under test.

## Root Cause

Ambient state is invisible by construction. It is not passed, not named, and not printed, so it
appears in neither the code under test nor the assertion — which is precisely what lets it feed
both. Nothing in the diff shows it, so review does not catch it either; only running the check in
a second environment does.

The defect and the instrument share the failure mode. In the work that produced this note, the
bug being fixed *was* an uncontrolled timezone; the test written to catch it had the same flaw;
and the mutation count offered as proof had it a third time. That is not coincidence — anything
reading ambient state inherits it, including the tools you reach for to check the first two.

## Solution

**Name the variable, pin it, and assert the pin.**

```ts
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  // A NONZERO offset, deliberately — see below.
  process.env.TZ = "Europe/Berlin";
});
afterAll(() => {
  // `delete`, never `= undefined` — that stringifies to the literal "undefined",
  // which resolves to offset 0: silently back to the zone that hides the bug.
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

it("pins the process timezone this file claims (guards the mechanism)", () => {
  expect(-new Date(2026, 6, 10).getTimezoneOffset()).toBe(120);
});
```

**Pin a zone with a nonzero offset, and assert that offset.** This is the part that is easy to get
backwards, and getting it backwards reproduces the very failure this file describes: a guard that
pins `"UTC"` and asserts an offset of `0` **cannot fail on a UTC host**, which is what CI runs.
Measured on Node 24.9.0 — with the host at UTC, `process.env.TZ = "Amerca/Denver"` (a typo),
`process.env.TZ = ""`, and no pin at all all yield offset `0`, so the check passes in every broken
case. Against a `Europe/Berlin` pin the same typo yields `0` against an expected `120` and fails
immediately.

That guard test is load-bearing. Without it, a pin that silently no-ops leaves every assertion in
the file passing for the wrong reason — green, and meaningless. With it asserting zero, the guard
is itself the thing it was supposed to prevent.

**A zero-offset control row needs one more precaution: negative zero.** Extending the guard to a
zone SWEEP that includes a `UTC` control row (rather than pinning one nonzero zone alone) hits a
second trap the snippet above doesn't show. `-new Date(...).getTimezoneOffset()` on a UTC host is
`-0`, not `0` — `toBe`'s `Object.is` semantics treat them as distinct, so the naive guard **fails on
correct code**:

```
AssertionError: expected -0 to be +0 // Object.is equality
```

Fix by normalizing before the comparison — `-0 + 0` is `0` under IEEE 754, so appending `+ 0` is
enough:

```ts
expect(-new Date(2026, 8, 1).getTimezoneOffset() + 0).toBe(ZONE_OFFSET_MINUTES[tz]); // UTC: 0
```

Neither in-repo instance of this guard (`shared/lib/__tests__/date.test.ts`,
`client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx`) hits this, because both only ever
pin nonzero-offset zones. A file's own zone sweep is the first place in this repo to add a `UTC`
control row to the mechanism guard itself (not just to the domain assertions) — expect this trap
wherever that pattern is repeated.

**Where to put the pin depends on what builds the fixtures.** A `beforeAll` runs after module
evaluation, so it does not reach anything constructed at collection time — `describe.each` /
`it.each` tables most of all (see the See Also entry below). Per-`describe` pins are the right
shape when a file sweeps several zones; a file-scope pin is right when one zone must hold for
every test. What matters is that the pin precedes fixture *construction*, not where it sits.

**Better still, pass the variable as data rather than pinning the process.** Where the code takes
the input as an argument or a header, supply it there:

```ts
await request(app).get("/api/daily-budget?date=2026-09-02").set("X-Timezone", tz);
```

Now the zone is not ambient at all: the test is deterministic on any machine *and* runs
unmodified in CI. Prefer this to `process.env` pinning whenever the seam exists.

**Make a probe prove its independent variable actually varied.** Print it on every row and read
those before reading the conclusion:

```
TZ=Europe/Berlin        offsetMin=120   ...
TZ=America/Los_Angeles  offsetMin=-420  ...
```

If the offsets are identical, the sweep did not sweep. This costs one column and would have
caught face 2 immediately.

## Prevention

**Write the test before the fix, and take green as a failure.** This is the only detector for
face 1. A test authored after the fix is green either way, and nobody downstream can tell the
difference.

**Quote a measurement with the environment it was taken in**, or take it in the environment that
matters. "Fails 3 tests" is not a fact; "fails 2 in CI, 3 on a UTC-6 host" is. Best is to remove
the dependence so there is one number.

**When two independent things agree, ask what they share.** Agreement is evidence only if
disagreement was possible. A shared helper, a shared default, a shared ambient read — each makes
"they match" uninformative.

**CI's environment is part of the design.** Here CI runs UTC, and UTC is the unique *host* zone in
which the UTC basis (`toDateString`) and the *host-local* basis (`toLocalDateString`) coincide — so
a guard that depends on the host zone is not weak there, it is inert. Know which value your CI
supplies for any ambient input a guard depends on, and assume it is the one that hides the bug.

Note the limit of that statement: a guard driven by a *user* zone — an `X-Timezone` header resolved
through `server/lib/civil-date.ts` — never reads the host zone at all, so it is unaffected by what
CI runs. That is precisely why passing the value as data is the stronger fix.

## Related Files

- `shared/lib/__tests__/date.test.ts` — the reference implementation: module-scope capture,
  `afterAll` restore with `delete`, and per-`describe` pins each asserting a NONZERO offset
  (`Europe/Berlin` → `120`, `America/Los_Angeles` → `-420`)
- `client/components/coach/__tests__/plan-slot-picker-utils.test.ts` — the same pattern sweeping
  several zones, which is why its pins are per-`describe` rather than file-scope; also the first
  in-repo instance of the `-0` control-row trap above
- `client/components/coach/__tests__/PlanSlotPickerSheet.test.tsx` — a rendered-component variant:
  pins `process.env.TZ` **and** fakes the system clock (`vi.useFakeTimers({ toFake: ["Date"] })` +
  `vi.setSystemTime`), because the component calls `new Date()` internally with no injectable
  seam; also the concrete example behind face 4 above (its pre-existing tests were the
  self-referential check that motivated adding this guard block)
- `server/routes/__tests__/goals.test.ts`, `server/routes/__tests__/nutrition.test.ts` — the
  better pattern: the zone travels as an `X-Timezone` header, so nothing is ambient
- `server/lib/civil-date.ts` — the helpers that let a timezone be passed rather than assumed

## See Also

- [Probes that signal absence by empty output must also check the exit code](empty-probe-output-needs-exit-code-check-2026-07-02.md) — the sibling probe-reliability failure: absence and failure taking the same branch
- [A hermetic git test fixture that relies on git init's ambient default branch name](hermetic-fixture-branch-name-must-be-pinned-not-ambient-2026-08-28.md) — the same ambient-input trap in a git fixture
- [describe.each tables evaluate before hooks, so a pinned env misses fixtures](each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md) — how a correct pin still fails to reach table-built fixtures
- [A test named for a property but asserting a literal snapshot pins the bug it claims to prevent](../code-quality/test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md) — the other way a green test proves nothing
- [A coverage ratio whose numerator and denominator come from different populations measures neither](ratio-over-a-column-mixing-two-corpora-measures-neither-2026-08-08.md) — measurement validity, one layer up
