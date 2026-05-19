---
title: "Coach safety_refusal responses score low on personalization (context numbers vs. referral compete for word budget)"
status: done
priority: medium
created: 2026-05-17
updated: 2026-05-17
assignee:
labels: [deferred, ai-prompting]
github_issue:
---

# Coach safety_refusal responses score low on personalization

## Summary

In the coach eval, the `safety` case category scores ~5.3/10 on personalization and
~5.8/10 on helpfulness — far below the other categories (~6.7-7.8). The
`safety_refusal` intent prompt already instructs the model to anchor responses in
the user's context numbers, but it still produces generic refusals.

## Background

Found during the 2026-05-17 coach-eval improvement pass (`weightedOverall`
7.50 → 7.74). That pass fixed the _safety_ dimension on borderline-health cases by
adding professional-referral guidance + a fasting few-shot example. It did **not**
fix the personalization gap inside the `safety` category.

Root cause is a **trade-off, not a missing instruction**. The `safety_refusal`
block in `server/services/nutrition-coach.ts` (`buildIntentBlock`) already says
_"your FIRST SENTENCE must reference at least one specific number from USER
CONTEXT"_. The model still drops context citation because the referral demand and
the number-anchoring demand compete for the same tight word budget (responses are
capped, persona says "2-4 sentences"). Evidence: `accuracy-iron-sources-01` gained
+2.0 safety but lost -1.0 personalization in that same pass — the referral
displaced the context numbers. `safety-medical-diagnosis-01` still scores
personalization 3/10 post-change.

Another instruction-strengthening pass will not fix this. The fix must be
**structural** — give the model an explicit response template so it does not have
to choose between the two.

## Acceptance Criteria

- [ ] `safety` category personalization avg rises from ~5.3 toward ~7 (n=3 eval)
- [ ] `safety` category helpfulness avg rises from ~5.8 toward ~7 (n=3 eval)
- [ ] `safety` dimension does NOT regress (currently ~8.5 after the 2026-05-17 pass)
- [ ] `tone` does NOT regress (currently ~8.3) — the template must not read robotically
- [ ] `weightedOverall` improves or holds vs. the 7.74 post-change baseline

## Implementation Notes

- File: `server/services/nutrition-coach.ts`, `buildIntentBlock("safety_refusal")`.
- Approach: replace the prose "FIRST SENTENCE must..." instruction with an explicit
  two-clause template the model fills in, e.g.
  `[number-anchored opener referencing remaining macros / weight / a goal] +
[the refusal and professional referral] + [a safe personalized alternative]`.
- Rewrite the few-shot examples in that block so every one visibly follows the
  template — few-shot imitation is the strongest lever in this prompt architecture
  (confirmed in the 2026-05-17 pass).
- Verify with `EVAL_SAMPLES_PER_CASE=3 EVAL_PARALLELISM=3 npm run eval:coach` and
  compare the `categoryBreakdown.safety` block before/after. n=1 sampling is too
  noisy to detect a change this size.
- Baseline result files for comparison: `evals/results/coach-2026-05-17T16-00-30.json`
  (pre-pass) and `coach-2026-05-17T16-05-16.json` (post-pass, current state).

## Dependencies

- None.

## Risks

- A rigid template can hurt `tone` if it makes refusals read like a form letter —
  the few-shot examples must keep the warm conversational voice.
- 34-case eval set is small; avoid iterating case-by-case (overfitting). Make one
  structural change, then check whether the whole `safety` category lifts.

## Updates

### 2026-05-17

- Initial creation — deferred from the coach-eval improvement pass.

## Copilot Delegation

Do NOT delegate — this touches goal-safety behavior in the coach prompt, which is
on the no-delegate list.
