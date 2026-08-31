---
title: "An uncontrolled ambient input makes the check agree with what it checks — the test cannot fail, the probe measures nothing, and the mutation count is your machine's"
track: bug
category: logic-errors
tags: [testing, harness, timezone, silent-failure, test-isolation, probes, evidence]
module: shared
applies_to: [server/services/__tests__/*.test.ts, server/routes/__tests__/*.test.ts, server/storage/__tests__/*.test.ts, server/lib/__tests__/*.test.ts, client/hooks/__tests__/*.test.ts, client/screens/**/__tests__/*.test.tsx, client/components/**/__tests__/*.test.tsx, shared/lib/__tests__/*.test.ts]
symptoms: ["A newly written test passes BEFORE the fix it was written for", "A probe reports 'no difference' across several configurations that should differ", "A mutation check fails N tests locally and a different N in CI", "A guard is green on CI and red on a developer machine, or the reverse, with no code change", "Two independent things agree suspiciously well and nothing explains why", "The control row of a parameterised table fails, when by definition it should be a no-op"]
created: '2026-08-31'
severity: medium
---

# An uncontrolled ambient input makes the check agree with what it checks

## Problem

A check is only worth its result if the thing it checks can differ from it. When both read the
same **ambient** input — the host timezone, `process.env`, the wall clock, the current working
directory, a locale — they move together, and the check becomes a mirror. It reports agreement
because it cannot report anything else.

This has three faces, and they are the same bug:

1. **A test that passes before the fix.** The buggy code read `new Date().getHours()` (the host
   zone); the test asserted an hour "in Los Angeles". On a machine near that zone the two agreed,
   so the test was green against code that was wrong.
2. **A probe that measures nothing.** A script sweeping four timezones set `process.env.TZ` in a
   loop at the top, clobbering the `TZ=…` the shell had supplied. All four "different" runs
   measured the same zone and printed a tidy table showing no difference anywhere.
3. **Evidence that is one machine's.** A mutation check reported "3 tests fail". Re-run under
   other host zones: 3 on `America/Denver`, **2 on UTC — which is what CI runs** — and 5 on
   `Pacific/Auckland`. The number quoted as proof was a property of the author's laptop.

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
// Pin at FILE scope, not per-describe: fixtures elsewhere in the file are built
// with local-time constructors and mean "8am wherever this runs".
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  // `delete`, never `= undefined` — that stringifies to the literal "undefined".
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

it("pins the process timezone this file claims (guards the mechanism)", () => {
  expect(new Date(2026, 6, 10).getTimezoneOffset()).toBe(0);
});
```

That last test is the load-bearing one. Without it, a pin that silently no-ops leaves every
assertion in the file passing for the wrong reason — green, and meaningless.

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

**CI's environment is part of the design.** Here CI runs UTC, which is the one zone where every
date basis in the system coincides — so an unpinned timezone guard is not weak, it is inert. Know
which value your CI supplies for any ambient input a guard depends on, and assume it is the one
that hides the bug.

## Related Files

- `server/services/__tests__/coach-context-builder.test.ts` — file-scope `TZ` pin with the
  `getTimezoneOffset()` mechanism guard
- `server/routes/__tests__/goals.test.ts`, `server/routes/__tests__/nutrition.test.ts` — the
  better pattern: the zone travels as an `X-Timezone` header, so nothing is ambient
- `server/lib/civil-date.ts` — the helpers that let a timezone be passed rather than assumed

## See Also

- [Probes that signal absence by empty output must also check the exit code](empty-probe-output-needs-exit-code-check-2026-07-02.md) — the sibling probe-reliability failure: absence and failure taking the same branch
- [A hermetic git test fixture that relies on git init's ambient default branch name](hermetic-fixture-branch-name-must-be-pinned-not-ambient-2026-08-28.md) — the same ambient-input trap in a git fixture
- [describe.each tables evaluate before hooks, so a pinned env misses fixtures](each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md) — how a correct pin still fails to reach table-built fixtures
- [A test named for a property but asserting a literal snapshot pins the bug it claims to prevent](../code-quality/test-named-for-a-property-must-assert-the-property-not-a-literal-2026-08-31.md) — the other way a green test proves nothing
- [A coverage ratio whose numerator and denominator come from different populations measures neither](ratio-over-a-column-mixing-two-corpora-measures-neither-2026-08-08.md) — measurement validity, one layer up
