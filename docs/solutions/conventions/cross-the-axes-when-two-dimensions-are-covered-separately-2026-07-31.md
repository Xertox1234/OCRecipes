---
title: "Thorough coverage on each axis separately leaves the intersection blind — cross the axes"
track: knowledge
category: conventions
tags: [testing, coverage, boundary-tests, combinatorial, nutrition, shared, test-design]
module: shared
applies_to: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"]
symptoms: ["A large suite passes while a reviewer finds a defect by hand in minutes", "Every test for feature A omits parameter B, and every test for parameter B uses the default of A", "A bug lives exactly where two well-tested dimensions meet", "Coverage tools report the lines as covered"]
created: 2026-07-31
---

# Thorough coverage on each axis separately leaves the intersection blind

## Rule

When a function's behaviour depends on two independent dimensions, testing each dimension
thoroughly **while holding the other at its default** proves nothing about their intersection.
Add at least one case that varies both at once — and pick the combination where the two
dimensions could plausibly disagree.

Line coverage will not tell you this is missing. Every line runs; only the *combination*
never does.

## Smell patterns

- Two `describe` blocks, one per dimension, and no test's fixture appears in both.
- An optional parameter that every test in one block omits — and that one other block is
  entirely about.
- A suite whose count is impressive (dozens of assertions) next to a defect a human found by
  reading.
- The fix for a found bug is a *guard* on the combination (`A && B`), which is the tell that
  the combination was never exercised.

## Why

In the incident behind this rule, `concernBand` bands a nutrient against UK FSA thresholds.
Two dimensions:

- **scale** — food (per 100 g) or drink (per 100 ml); drink thresholds are roughly half
- **portion weight** — an optional per-portion override that promotes to `high`

48 tests passed. Every drink test omitted `portionGrams`; every portion-override test used a
food basis. The two axes were never crossed — so nobody noticed that the per-portion table is
the **food** table and was being applied to drinks regardless of scale:

```
concernBand("sugar", 39, drinkBasis355)        -> medium   ✅ tested
concernBand("sugar", 6.1, foodBasis240, 240)   -> high     ✅ tested
concernBand("sugar", 39, drinkBasis355, 355)   -> high     ❌ never tested — and wrong
```

A 500 ml drink with 28 g sugar (5.6 g/100 ml — comfortably medium) banded **red**, because
28 > 27, the food portion line. Both single-axis families were correct; only their product
was wrong.

This generalises past nutrition. The same shape produces: a feature flag tested only on the
default tier and a tier tested only with the flag off; a retry path tested only on the happy
codec; a timezone tested only at noon.

## Examples

Name the axes explicitly, then write the crossing:

```ts
// Axis 1: scale.        Axis 2: portion weight supplied?
// The crossing that matters is (drink, portion supplied) — the one combination
// where the food-scale portion table could leak onto a drink.
it("does not apply the FOOD portion line to a drink", () => {
  const drink: Basis = { kind: "resolved", scale: "drink", factor: 100 / 355 };
  expect(concernBand("sugar", 39, drink, 355)).toBe("medium");
});

// Keep a control proving the gate GATES rather than DISABLES.
it("still promotes on the food scale", () => {
  const food: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
  expect(concernBand("saturatedFat", 6.1, food, 240)).toBe("high");
});
```

That control is not optional. A fix that gates a code path and a fix that deletes it look
identical to a suite that only checks the previously-broken case now returns the right answer.

## Exceptions

- Genuinely independent dimensions (a logger level and a parser's input) do not need crossing.
  The test is whether one dimension can *reach* the branch the other selects — if both feed
  the same conditional, cross them.
- Full combinatorial coverage is rarely worth it. Cross the pairs where a shared constant, a
  shared table, or a shared branch is selected by one axis and consumed by the other.

## Related Files

- `shared/lib/nutrition-bands.ts` — `concernBand`, whose per-portion override is now gated on `basis.scale === "food"`
- `shared/lib/__tests__/nutrition-bands.test.ts` — the crossed cases and the food-scale control

## See Also

- [gate-test-needs-two-sided-negative-control-2026-07-25.md](gate-test-needs-two-sided-negative-control-2026-07-25.md) — the related "green cannot be distinguished from never-triggered" failure
- [gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md](gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md) — a suite that looks comprehensive but shares an origin
- [../logic-errors/disjunctive-gate-alternatives-sharing-one-failure-mode-2026-07-30.md](../logic-errors/disjunctive-gate-alternatives-sharing-one-failure-mode-2026-07-30.md) — two clauses that read as independent coverage but are not
