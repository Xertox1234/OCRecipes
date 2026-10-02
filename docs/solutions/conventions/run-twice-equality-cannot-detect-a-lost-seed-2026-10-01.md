---
title: "A run-twice equality test cannot detect a lost seed when the outputs are discrete — pin golden values on non-integer inputs"
track: knowledge
category: conventions
tags: [testing, determinism, seeded-rng, bootstrap, ai-evals]
module: server
applies_to: ["evals/**/*.ts", "scripts/**/*.ts"]
created: 2026-10-01
---

# A run-twice equality test cannot detect a lost seed when the outputs are discrete

## Rule

To prove a seeded random function is deterministic, assert **pinned output
values**, not "two runs give the same result". Choose inputs whose outputs are
spread out: non-integers with distinct gaps, so that an unseeded run is
unlikely to land on the pinned value by chance. Check the chance-match rate
once by swapping in `Math.random` and counting how often the test still
passes.

## Why

`run(x)` equal to `run(x)` is satisfied by the seeded version, and it is also
satisfied by an unseeded version whenever both runs happen to agree. A
percentile bootstrap over a small integer sample has only a handful of
possible percentile values, so two unseeded runs agree often.

Measured on `bootstrapMeanCI` (Lane C Task 1, 2026-10-01). The test it measured
is the one the plan specified: run twice on integer inputs, `toEqual`.

| Implementation under that test                  | Passes                |
| ----------------------------------------------- | --------------------- |
| `Math.random` instead of `mulberry32(42)`       | 454 / 1000 runs       |
| same, with vitest's `retry: 2`                  | ~84% of runs          |
| `Math.random` vs the pinned golden (below)      | 1 / 2000 runs         |

So the plan's test would have passed about half the time with the seed gone,
and this repo's retry setting would have hidden most of the remaining
failures as flakes. The pinned version fails essentially every time.

## Examples

```ts
// evals/__tests__/bootstrap.test.ts
it("reproduces the seeded interval", () => {
  const ci = bootstrapMeanCI([1.3, 2.9, 3.4, 4.8, 5.1, 6.7, 7.2, 9.6]);
  expect(ci.mean).toBeCloseTo(5.125, 9);
  expect(ci.lower).toBeCloseTo(3.4375, 9);
  expect(ci.upper).toBeCloseTo(7, 9);
});
```

Each single-line break produced a failure in this test: `Math.random`, a
different seed (`mulberry32(7)`), and `ITERATIONS = 999`.

## Exceptions

- A golden pins the exact float arithmetic. A refactor that reorders a sum can
  move the last few digits, so the golden must be re-derived and the change
  reviewed. That is the intended cost.
- Where the property is "same seed gives the same sequence" (testing the PRNG
  itself, as `mulberry32 is a pure function of its seed` does), comparing two
  instances is correct. The rule covers testing a *consumer* of the seed.

## Related Files

- `evals/lib/bootstrap.ts` — `bootstrapMeanCI`, `mulberry32`, `BOOTSTRAP_SEED`
- `evals/__tests__/bootstrap.test.ts` — the pinned test and its chance-match comment

## See Also

- [fast-check-property-tests-pin-seed-not-in-mutation-testinclude](fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md) — the other half of seeded-test hygiene: pin the property-test seed itself
- [../logic-errors/bootstrap-over-samples-not-cases-narrows-the-interval-2026-10-01.md](../logic-errors/bootstrap-over-samples-not-cases-narrows-the-interval-2026-10-01.md) — the same bootstrap's other trap
