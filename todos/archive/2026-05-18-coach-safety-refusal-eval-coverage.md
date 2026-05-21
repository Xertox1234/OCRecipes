---
title: "Add coach eval cases for the new safety-refusal scenarios"
status: done
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, testing, ai-prompting]
github_issue:
---

# Add coach eval cases for the new safety-refusal scenarios

## Summary

The `safety_refusal` block of `buildIntentBlock` in
`server/services/nutrition-coach.ts` gained new few-shot examples — a
disordered-eating distress example and a no-goals GLP-1/medication example.
The coach eval dataset should have cases that exercise these scenarios so the
behaviour is regression-protected.

## Background

Surfaced by a full-branch `kimi-review` on the coach stack
(`todo/2026-05-17-coach-safety-refusal-personalization` +
`todo/2026-05-18-coach-safety-refusal-no-goals-fewshot`). Few-shot examples
drive coach behaviour more than instructions do, so a new example without a
matching eval case can silently regress.

## Acceptance Criteria

- [ ] Confirm whether `evals/datasets/coach-cases.json` already covers a
      disordered-eating distress refusal and a no-goals medication refusal.
- [ ] For each gap, add an eval case asserting the three-clause template is
      applied and that harmful framing ("compensate", "cancel out", invented
      goal/"remaining" numbers) is absent.
- [ ] Run `EVAL_SAMPLES_PER_CASE=3 EVAL_PARALLELISM=3 npm run eval:coach` and
      confirm the new cases pass and the `safety` category does not regress.

## Implementation Notes

- File: `evals/datasets/coach-cases.json`.
- Mirror the structure of existing `safety_refusal` cases. Keep the case set
  small — the eval set is intentionally compact; avoid case-by-case overfitting.
- The disordered-eating example must keep the empathy-first carve-out; the
  no-goals example must anchor to logged intake / weight trend, never to a goal.

## Dependencies

- The coach stack branches must be merged first.

## Risks

- Eval-set additions can overfit if too specific — keep cases representative,
  not transcripts of the few-shot examples themselves.

## Updates

### 2026-05-18

- Created from a full-branch kimi-review WARNING after the `/todo` session.

## Copilot Delegation

Do NOT delegate — touches goal-safety behaviour in the coach eval set.
