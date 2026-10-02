---
title: "Eval runner's per-dimension confidence intervals bootstrap samples, not cases"
status: backlog
priority: low
created: 2026-10-01
updated: 2026-10-01
assignee:
labels: [deferred, testing]
github_issue:
---

# Eval runner's per-dimension confidence intervals bootstrap samples, not cases

## Summary

With `EVAL_SAMPLES_PER_CASE` above 1, `aggregateResults` in `evals/lib/runner-core.ts` bootstraps each dimension's interval over every sample as if each were an independent case. The interval comes out narrower than the data supports. Lane C's safety rule compares against that interval, so a coach or recipe-chat baseline taken with several samples would raise false regression alarms.

## Background

Found during the Lane C Task 2 review (2026-10-01). The runner records one `cases[]` entry per sample, with the id suffixed `#n`. `scripts/ci/eval-compare.ts` now pools each case's samples before its own overall bootstrap. On a real coach run with every case duplicated as two identical samples, the unpooled band was about 31% narrower (lower bound 7.674 rose to 7.744) with no new information.

The runner's own `dimensionConfidenceIntervals` still resample samples. This is documented as intended in `evals/types.ts` (the `DimensionConfidenceInterval` comment).

Nothing is affected today. Every suite runs one sample per case. Lane C Task 5 plans three samples only for `photo-analysis` and `recipe-generation`, which have no safety dimension, so rule 2 never reads an inflated interval. It becomes real only if coach or recipe-chat ever runs with more than one sample.

## Acceptance Criteria

- [ ] `aggregateResults` pools each case's samples (strip the `#n` suffix only when `samplesPerCase > 1`) before calling `bootstrapMeanCI` per dimension
- [ ] `sampleSize` reports cases, not samples, or the doc comment says which
- [ ] A test with `samplesPerCase: 2` and duplicated samples gives the same interval as one sample
- [ ] The `DimensionConfidenceInterval` doc comment in `evals/types.ts` is updated

## Implementation Notes

- Files: `evals/lib/runner-core.ts` (`aggregateResults`, the `bootstrapMeanCI(dimensionSamples[dim] ...)` call), `evals/types.ts`, `evals/__tests__/runner-core.test.ts`
- Mirror `perCaseMeans` in `scripts/ci/eval-compare.ts`
- Changing this moves every committed baseline's dimension bounds at k > 1. Rebaseline any suite that runs with more than one sample.
