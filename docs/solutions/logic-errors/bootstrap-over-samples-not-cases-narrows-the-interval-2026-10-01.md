---
title: "A bootstrap over repeated samples of the same case narrows the interval with no new information — pool per case, then resample cases"
track: bug
category: logic-errors
tags: [testing, ai-evals, statistics, bootstrap, regression-detection]
module: server
applies_to: ["scripts/ci/eval-compare.ts", "evals/lib/runner-core.ts", "evals/lib/bootstrap.ts"]
symptoms: ["A confidence interval gets narrower when EVAL_SAMPLES_PER_CASE goes up, even when the extra samples repeat the first", "A regression gate built on that interval raises alarms on noise that a one-sample run would absorb"]
created: 2026-10-01
severity: medium
---

# A bootstrap over repeated samples of the same case narrows the interval with no new information

## Problem

With `EVAL_SAMPLES_PER_CASE` above 1, the eval runner writes one `cases[]`
entry per sample, with the id suffixed `#1`, `#2`, and so on. The first version
of `scripts/ci/eval-compare.ts` (Lane C Task 2, b8301f09) bootstrapped over
every entry as if each were an independent case. Lane C's regression rule
fails a run whose mean falls below the baseline's lower bound, so an
artificially narrow baseline makes the gate fire on noise.

## Symptoms

Measured on a real coach results file (Lane C Task 2 fix, 2026-10-01). The same
data was duplicated so that every case appears as two identical samples:

| Version                        | Overall lower bound |
| ------------------------------ | ------------------- |
| k=1, original data             | 7.674               |
| k=2 duplicate, pooled per case | 7.674 (identical)   |
| k=2 duplicate, old per-sample  | 7.744               |

The old code narrowed the band by about 31% from zero new information.

## Root Cause

A bootstrap estimates sampling error by resampling the **independent unit**.
Here that unit is the test case: the samples of one case share its prompt,
its fixture and its difficulty, so they are strongly correlated. Treating k
samples as k cases multiplies the effective n by up to k, and the interval
shrinks by about 1/√k.

## Solution

Pool each case's samples into one per-case mean before bootstrapping
(`perCaseMeans` in `scripts/ci/eval-compare.ts`). Strip the `#n` suffix only
when `samplesPerCase > 1`, so a real case id containing `#` is never merged;
all five datasets were checked and none does. Record `samplesPerCase` in the
baseline, and warn when the current run differs from the baseline, as is
already done for a changed judge model.

## Prevention

- Before writing any bootstrap or standard error, name the independent unit
  and check that the array being resampled has one entry per unit.
- Positive control: duplicate every unit and assert that the interval does
  **not** change (`pools a case's samples when samplesPerCase > 1` in
  `scripts/__tests__/eval-compare.test.ts`).
- Known residual: `aggregateResults` in `evals/lib/runner-core.ts` still
  bootstraps per-dimension intervals over samples (documented in
  `evals/types.ts`). It is harmless while every suite runs one sample per case,
  and it is tracked as a P3 todo
  (`todos/P3-2026-10-01-eval-runner-dimension-ci-bootstraps-samples-not-cases.md`).

## Related Files

- `scripts/ci/eval-compare.ts` — `perCaseMeans`, `toBaseline`, `compareSuite`
- `scripts/__tests__/eval-compare.test.ts` — the pooling control
- `evals/lib/runner-core.ts` — writes the `#n`-suffixed sample entries

## See Also

- [../conventions/run-twice-equality-cannot-detect-a-lost-seed-2026-10-01.md](../conventions/run-twice-equality-cannot-detect-a-lost-seed-2026-10-01.md) — the same bootstrap's determinism test
