---
title: "A fixture stops guarding the moment you fix the defect it documents — re-verify every test that used the old behaviour as evidence, not just the ones that go red"
track: knowledge
category: conventions
module: shared
tags: [testing, fixtures, regression-tests, review, verification, false-confidence]
applies_to: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx", "client/lib/**/*.ts"]
created: '2026-08-05'
---

# A fixture stops guarding the moment you fix the defect it documents

## Rule

When a fix changes what a shared fixture parses, produces, or returns, **audit every test that
used the old behaviour as evidence** — not only the tests that fail.

A test that goes red tells you it needs attention. A test that stays green while its premise
evaporates tells you nothing at all, and is the more dangerous outcome.

## Smell patterns

- A fixture is described as "the capture where X and Y were both null" — and a later fix
  recovers one of them
- A test's comment explains *why* a rule exists, using values the fix just changed
- A regression guard for a removed condition, where the fixture no longer triggers that
  condition
- A "boundary" describe block whose cases all fall on one side of the boundary
- A verification script written to check a fix, never itself checked

## Why

**The concrete instance.** `isLabelReady` requires calories plus a parseable serving, and
deliberately does *not* also require sugars-or-fat. The reason is recorded in a fixture: a
device capture of a Cherry Coke can where MLKit's `g` → `9` misread nulled sugars **and** fat
simultaneously, so "either one" was never the independent corroboration it looked like.

Fixing `g` → `9` at the parse recovered that capture's fat (`0 g`, correct for a soda).
Under the old gate — `totalSugars != null || totalFat != null` — the fixture would now
**pass**. The test stayed green. The guard against re-introducing the removed clause had
silently stopped guarding, and nothing in the diff, the test run, or CI said so.

The fix was not to delete the test but to rebuild the fixture so it keeps the property that
mattered: both fields **present in the text and both lost**, each to a defect documented
elsewhere in the file. A fixture that merely omitted the two lines would prove only that
absent fields are absent.

**Why this is systematically hard.** Fixing a bug moves the ground the test stands on. Red
tests are self-announcing; a test whose *premise* dissolved while its *assertions* still hold
is not. Fixture-based regression tests are the most exposed, because the fixture is shared
between "what the code does" and "why the rule exists" — and only the first is asserted.

This shape recurred four times in a single session on one file:

1. A device probe hand-mirrored a production gate; the gate changed, the mirror did not, and
   the probe printed confident verdicts the app never reached
2. The Cherry Coke fixture above
3. A boundary suite written for a specific risk that never tested the failing side of the
   boundary — which is why a HIGH defect shipped green
4. Two ad-hoc verification scripts whose own escaping bugs produced confident, wrong verdicts
   about the code under test

## Examples

**Audit step, after any fix that changes shared fixture output:**

```bash
# every test referencing the fixture, not just failing ones
grep -rn "CHERRY_COKE_DEVICE_OCR" client/lib/__tests__/
```

Then, for each hit, ask: *does this assertion still fail if the rule it protects is reverted?*
If not, the guard is gone regardless of its colour.

**Preserve the property, not the fixture.** When a fixture can no longer exercise its case,
rebuild it around the property:

```ts
// Both fields are PRESENT in the text and both are lost — fat to the ambiguous
// glued `g`->`9` ("09"), sugars to a dropped "/" separator. A fixture that simply
// omitted the two lines would prove only that absent fields are absent.
const parsed = parseNutritionFromOCR(
  "Nutrition Facts\nPer 1 can (355 mL)\nCalories 140\nFat / Ipldes 09\nSugars Sucres 39 9",
);
expect(parsed.totalSugars).toBeNull();
expect(parsed.totalFat).toBeNull();
expect(isLabelReady(parsed)).toBe(true);
```

**Record what is still broken, with its cause.** Assertions that expect `null` turn expensive
fixtures into a ledger: each names the defect that keeps it null, and flips to a value when
that defect is fixed — which makes the follow-up PR verifiable by a failing test rather than
by re-reasoning from scratch.

```ts
expect(r.totalFat).toBeNull(); //   "Lipides 2.59" is "Lipides 2.5 g" — ambiguous glued g→9
expect(r.protein).toBeNull(); //    value landed on the line BEFORE the name — column merge
```

## Exceptions

- A fixture asserting only *stable* external output (an API response shape, a vendor payload)
  is not exposed to this: your fix cannot move it. That case is the opposite convention —
  reproduce the dependency's output verbatim.
- Snapshot tests already fail loudly on any change, so they announce themselves. The hazard is
  specific to hand-written assertions over a shared fixture.

## Related Files

- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — `does not require sugars or fat, even when neither was read`
- `client/lib/nutrition-ocr-parser.ts` — `isLabelReady` docblock

## See Also

- [../best-practices/test-fixture-must-match-real-dependency-output](../best-practices/test-fixture-must-match-real-dependency-output-2026-05-15.md) — the complementary rule: fixtures must reproduce the real dependency verbatim
- [../logic-errors/alternation-fallback-fires-before-backtracking-to-primary](../logic-errors/alternation-fallback-fires-before-backtracking-to-primary-2026-08-05.md) — the fix that disarmed the fixture, and the boundary suite that missed one side
- [../logic-errors/disjunctive-gate-alternatives-sharing-one-failure-mode](../logic-errors/disjunctive-gate-alternatives-sharing-one-failure-mode-2026-07-30.md) — the rule the disarmed fixture existed to protect
