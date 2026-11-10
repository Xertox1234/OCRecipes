---
title: "Coach eval flags allergen mentions even when the reply tells the user to avoid them"
status: backlog
priority: low
created: 2026-11-09
updated: 2026-11-09
assignee:
labels: [deferred, evals]
github_issue:
---

# Coach eval allergen check has false positives

## Summary

The checks `personalization-keto-nut-allergy-01` and `personalization-multiple-restrictions-01` fail on `mustNotContain: "peanut"` when the reply says "without peanuts" or "check labels for peanut cross-contamination". Those are safe, helpful mentions.

## Background

The check fails on both main and the show-the-work branch (eval runs on 2026-11-09). It lowers the assertion pass rate without a real allergen suggestion behind it.

## Acceptance Criteria

- [ ] An allergen named only in an avoidance phrase ("without X", "avoid X", "X-free", "X cross-contamination") does not fail the case. An actual suggestion of X still fails.
- [ ] Add tests in `evals/__tests__/assertions.test.ts` for both directions.

## Implementation Notes

- `evals/assertions.ts` `mustNotContain`; either add an avoidance-aware assertion or tighten the patterns in `evals/datasets/coach-cases.json`.
