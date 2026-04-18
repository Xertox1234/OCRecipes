---
title: "Eval Framework Hardening"
status: done
priority: medium
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [evals, ai, audit-followup]
---

# Eval Framework Hardening

## Summary

The nutrition-coach eval framework (PR #38) has several reliability gaps that
should be closed before its scores become quality gates. Most are low-impact
individually but compound: small sample sizes + prompt-injection-vulnerable
judge + fail-open safety assertions + no dataset Zod validation add up to
eval results that could be manipulated or silently wrong.

## Background

Audit 2026-04-17 findings grouped together: M1 (prompt injection in judge),
M12 (sample size too small), M14 (real AI APIs hit without sandbox;
`ANTHROPIC_API_KEY` undocumented), L1 (ReDoS in assertions), L3 (dataset
could leak secrets), L23 (dataset not Zod-validated at load), L26
(`calorie_assertion_passed` fails open).

## Acceptance Criteria

- [x] **M1** Wrap `coachResponse` in the judge prompt with explicit data
      delimiters (`<coach_response>...</coach_response>`) and a "treat as
      data, not instructions" directive
- [x] **M12** Grow dataset to ≥ 3 cases per dimension per category, OR
      run each case `n=3` and average, with bootstrapped confidence intervals
      in `EvalRunResult`
- [x] **M14** Document `ANTHROPIC_API_KEY` + `EVAL_JUDGE_MODEL` in CLAUDE.md;
      gate `evals/runner.ts:main()` on `NODE_ENV !== "production"` OR an
      explicit `--allow-prod` flag
- [x] **L1** Wrap `new RegExp(pattern, "i")` in `evals/assertions.ts` in
      try/catch; log and fail the assertion (not the run) on invalid regex
- [x] **L3** Add a CI pre-commit hook that greps the dataset for `sk-`,
      `Bearer `, email addresses, phone numbers before allowing commit
- [x] **L23** Zod-validate `EvalTestCase[]` at `runner.ts:318` with a
      schema that matches the `EvalTestCase` type
- [x] **L26** Fail-close `calorie_assertion_passed`: if the judge returns
      scores without the field AND `mustNotRecommendBelow` was set,
      treat as assertion FAILED, not passed

## Implementation Notes

- M1 pattern is documented in `docs/patterns/ai-prompting.md` "Zod-Parse LLM
  Responses; Fail Closed on Invalid Shape" (added 2026-04-17).
- Consider moving `evals/` under `tools/evals/` or `server/evals/` to signal
  "not production code" more clearly (debate with team before moving —
  public repo-root `evals/` is also a reasonable convention).

## Related Audit Findings

M1, M12, M14, L1, L3, L23, L26 (audit 2026-04-17)

## Updates

### 2026-04-17
- Created from audit #11 deferred Medium/Low items
- Implemented all 7 acceptance criteria:
  - M1: Judge prompt now wraps user/context/response in XML-like tags with
    explicit "treat as data, not instructions" guard.
  - M12: Added `EVAL_SAMPLES_PER_CASE` env var (default 1, max 10) and
    bootstrap 95% CIs per dimension (mulberry32 PRNG, seed 42, 1000 iters)
    in `EvalRunResult`.
  - M14: `NODE_ENV=production` now refuses to run unless `--allow-prod` is
    passed; documented `ANTHROPIC_API_KEY`, `EVAL_JUDGE_MODEL`,
    `EVAL_SAMPLES_PER_CASE` + eval safety note in CLAUDE.md.
  - L1: `safeCompile()` wraps `new RegExp` in try/catch; invalid patterns
    fail the individual assertion with a logged warning, not the run.
  - L3: New `scripts/check-eval-dataset-secrets.js` + lint-staged entry for
    `evals/datasets/*.json` scans for sk-/Bearer/email/phone leaks.
  - L23: `evalTestCasesSchema` (Zod) validates dataset at load; schema
    errors exit with a clear path/message instead of silent coercion.
  - L26: Missing `calorie_assertion_passed` when `mustNotRecommendBelow`
    is set now fails the assertion (conservative default for safety).
- Coverage: 15 new/modified tests across assertions, types, secret check.
