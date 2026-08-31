---
title: "describe.each/it.each tables are evaluated before any hook runs, so a fixture built in the table ignores the environment a beforeAll pinned"
track: bug
category: logic-errors
tags: [testing, typescript, react-native, timezone, date, silent-failure, vitest]
module: client
applies_to: [client/**/__tests__/*.test.ts, client/**/__tests__/*.test.tsx, shared/**/__tests__/*.test.ts, server/**/__tests__/*.test.ts]
symptoms: ["A parameterised test fails in the one case that should be a no-op control (e.g. the UTC row of a timezone table)", "The same assertion passes when written as a plain it() and fails inside it.each", "A test pinning TZ or a fake clock in beforeAll behaves as if the pin never happened", "Failures whose expected/actual differ by exactly the host machine's offset", "A suite that passes on CI and fails locally, or the reverse, with no code change"]
created: '2026-08-31'
severity: medium
---

# `describe.each`/`it.each` tables are evaluated before any hook runs

## Problem

Vitest and Jest build the `.each` table during **collection**, when the module body is executed —
strictly before `beforeAll`, `beforeEach`, or any other hook. A value constructed inside the table
therefore captures whatever the environment was at import time, not what a hook later pinned.

The failure is quiet because the value still exists and still has the right *type*. Only its
meaning is wrong.

```ts
describe.each(["UTC", "Europe/Berlin"])("buildPlanSlotDays (TZ=%s)", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;          // runs AFTER the table below was already built
  });

  it.each([
    ["23:00 local", new Date(2026, 8, 1, 23)],   // ← built in the HOST zone
    ["00:30 local", new Date(2026, 8, 1, 0, 30)],
  ])("keys iso to the local calendar day (%s)", (_label, from) => {
    expect(buildPlanSlotDays(from)[0].iso).toBe("2026-09-01");
  });
});
```

`new Date(2026, 8, 1, 23)` is an *instant*, fixed at collection time using the host's offset. The
test body then reads that instant back under the pinned zone. The fixture belongs to neither
environment, so the test verifies neither.

## Symptoms

- **The control row fails.** The clearest tell: the `TZ=UTC` case is supposed to be a no-op and it
  fails anyway. Nothing about the code under test is UTC-specific, so the environment must be the
  variable — the fixture was born somewhere else.
- Expected and actual differ by exactly the host machine's UTC offset, or by one calendar day.
- Rewriting the same case as a plain `it()` with the fixture inside the body makes it pass, with
  no change to the assertion.
- On a UTC CI runner the mismatch can vanish entirely (host zone == pinned zone), so the suite is
  green in CI and red on a developer's machine — or the reverse.

Observed concretely: four failures across `TZ=UTC`, `Europe/Berlin`, `Pacific/Auckland` and
`America/Los_Angeles`, where the host was `UTC-6`. Each row read the same host-built instant under
a different pinned zone.

## Root Cause

Hooks are registered during collection and invoked during the run. `.each` arguments are ordinary
expressions in the module body, so they are evaluated in the first phase and frozen. Anything that
reads ambient state at construction time — `new Date(y, m, d)`, `Intl.DateTimeFormat()`,
`process.env.X`, a locale-dependent formatter, a `Math.random()` seed — captures the pre-hook
environment.

This is the same hazard as the better-known ESM one (module-scope `process.env.TZ = "..."` is
hoisted *below* imports, so it misses any `Date` built at import time), but harder to spot: the
assignment here is correctly placed inside a hook, and it *does* take effect — just not for the
table.

## Solution

Pass **primitive descriptions** in the table and construct the ambient-dependent value inside the
test body, where hooks have already run:

```ts
it.each([
  ["23:00 local", 23, 0],
  ["00:30 local", 0, 30],
])("keys iso to the local calendar day (%s)", (_label, hour, minute) => {
  const from = new Date(2026, 8, 1, hour, minute);   // built under the pinned TZ
  expect(buildPlanSlotDays(from)[0].iso).toBe("2026-09-01");
});
```

Numbers, strings and booleans are safe in the table — they carry no environment. A `Date`, a
formatter, a seeded RNG, or anything reading `process.env` is not.

**Guard the pin itself.** Add one assertion per parameterised block proving the environment is
what the hook claims, so a mechanism failure is loud rather than vacuous:

```ts
it("pins the timezone it claims to (guards the mechanism, not the code)", () => {
  expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(120);
});
```

Without it, a pin that silently no-ops leaves every assertion in the block passing for the wrong
reason.

## Prevention

**Treat a failing control row as evidence about the harness, not the code.** When a
parameterised suite fails in the case that is defined to change nothing, stop and check where the
fixtures were built. The instinct to adjust the assertion is wrong here — the assertion was right.

**`process.env` mutation inside a hook does work.** Verified on Node 24 inside a Vitest worker:
assigning `process.env.TZ` at runtime updates `getTimezoneOffset()`, `toISOString()`,
`toLocaleDateString()` and `Intl` resolution, even after `Date` has already been used, and
`delete process.env.TZ` restores the system zone. `vitest.config.ts` uses `pool: "forks"`, so the
mutation is process-local and cannot leak into another test file. So the hook is the right place
for the pin — the bug is only ever the fixture's birthplace.

**Restore with `delete`, not `= undefined`.** Assigning `undefined` to a `process.env` key
stringifies it to the literal `"undefined"`, which is a valid-looking and completely wrong zone.

**A pinned value leaks to later sibling blocks in the same file.** `describe.each` leaves the
environment at its final entry for whatever `describe` follows, until the file-level `afterAll`.
Harmless when the trailing block is environment-independent, but say so in a comment rather than
leaving it implicit.

## Related Files

- `client/components/coach/__tests__/plan-slot-picker-utils.test.ts` — the zone loop, with the
  hour passed as a number and the `Date` built in the body
- `shared/lib/__tests__/date.test.ts` — per-zone blocks with the `getTimezoneOffset()` mechanism
  assertion
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` — the same pin combined with
  `vi.useFakeTimers({ toFake: ["Date"] })`
- `vitest.config.ts` — `pool: "forks"`, which is what makes per-file `process.env` pinning safe

## See Also

- [Two writers of one date column must share a normalisation basis](two-writers-of-one-date-column-must-share-a-normalisation-basis-2026-08-31.md) — the defect whose regression guard this hazard was found inside
- [A test named for a property but asserting a literal snapshot pins the bug it claims to prevent](../code-quality/test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md) — the sibling failure mode, where the harness is fine and the assertion is not
- [A test comment must claim only what its own harness can observe](../code-quality/a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — the same discipline applied to the prose around a guard
