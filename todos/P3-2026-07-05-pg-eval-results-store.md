<!-- Filename: P3-2026-07-05-pg-eval-results-store.md -->

---

title: "PG Lab: eval-results time series for evals/runner.ts"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, ai]
github_issue:

---

# PG Lab: eval-results time series for evals/runner.ts

## Summary

Persist every eval run's per-case judge scores to `dev.eval_results` in `ocrecipes_lab`, turning prompt-regression detection for the AI services (photo-analysis, nutrition-coach, recipe-chat, recipe-generation) into a queryable curve instead of a run-and-forget console dump.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. `evals/runner.ts` already produces LLM-judge scores (EVAL_JUDGE_MODEL, EVAL_SAMPLES_PER_CASE) but results evaporate after each run — there is no way to ask "did the 2026-06 prompt change to photo-analysis regress intent classification?" This is the most code-quality-adjacent PG Lab item since the AI services are core product.

## Acceptance Criteria

- [ ] `scripts/pg-lab/schema/eval-results.sql`: `dev.eval_results(run_id, ts, commit, case_id, service, judge_model, samples, score, pass, notes jsonb)` — append-only ledger.
- [ ] `evals/runner.ts` writes one row per case-sample at run end (buffered), keyed by a generated run_id + `git rev-parse --short HEAD`.
- [ ] Fail-silent: no DB → runner behaves exactly as today (evals must never require Postgres).
- [ ] `scripts/pg-lab/eval-report.sh`: score trend per case/service across commits; regression flag when a case drops ≥ a threshold vs its trailing mean.
- [ ] Existing eval runner tests still pass; new unit test for the writer (mock client, fail-silent path).
- [ ] Value probe: next time any AI-service prompt changes, the report must answer "regressed or not" — record the first real use in this todo's Updates before archiving.

## Implementation Notes

- Touch `evals/runner.ts` minimally: extract a `persistResults(results)` function; keep the runner's `--allow-prod` guard logic untouched.
- Reuse the `pg` dep and the connect-timeout fail-silent pattern from the flake-ledger todo (same shape; whichever merges first sets the pattern).
- `notes jsonb` captures judge rationale if the runner exposes it — cheap now, useful for debugging judge drift.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Eval runs are already slow/expensive; persistence must add ~0 wall time (single flush).
- Score comparability across judge-model changes — store judge_model per row so trends can be segmented.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch B).
